import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as crypto from "crypto";
import * as types from "./types";

export const info = {
  publicPort: 55121,
};

export type IPv4Address = {
  address: string;
  netmask: string | number;
};

export type PeerArgs = {
  listenPort: pulumi.Input<number>;
  address: pulumi.Input<IPv4Address>[];
  endpoint: pulumi.Input<string>;
  connection: types.Connection;
};

export class Peer extends pulumi.ComponentResource {
  listenPort: pulumi.Input<number>;
  address: pulumi.Input<IPv4Address>[];
  endpoint: pulumi.Input<string>;
  connection: types.Connection;

  publicKey: string;
  privateKey: string;

  name: string;
  childInfo: pulumi.ComponentResourceOptions;

  constructor(
    name: string,
    peerArgs: PeerArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("multi-kit:wireguard:peer", name, {}, opts);

    this.name = name;
    let key = crypto.generateKeyPairSync("x25519", {
      publicKeyEncoding: { format: "der", type: "spki" },
      privateKeyEncoding: { format: "der", type: "pkcs8" },
    });

    this.publicKey = key.publicKey.subarray(12).toString("base64");
    this.privateKey = key.privateKey.subarray(16).toString("base64");

    this.address = peerArgs.address;
    this.listenPort = peerArgs.listenPort;
    this.endpoint = peerArgs.endpoint;
    this.connection = peerArgs.connection;
    this.childInfo = pulumi.mergeOptions(opts, { parent: this });
  }

  setupHost(...peers: Peer[]) {
    return new command.remote.Command(`${this.name}-setup`, {
      connection: this.connection,
      addPreviousOutputInEnv: false,
      logging: "stdoutAndStderr",
      triggers: ["669"],
      create: pulumi.interpolate`sudo bash<<__EOF__
set -xeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -qy wireguard
cat<<EOF > /etc/wireguard/wg0.conf
${genConfig(this, peers)}
EOF
systemctl restart wg-quick@wg0
__EOF__
`,
    });
  }
}

export function genConfig(iface: Peer, peers?: Peer[]) {
  let output = pulumi.interpolate`[Interface]
Address = ${pulumi.output(iface.address).apply((a) => a.map((o) => `${o.address}/${o.netmask}`).join(", "))}
ListenPort = ${iface.listenPort}
PrivateKey = ${iface.privateKey}
`;

  if (peers) {
    const sections = pulumi.all(peers).apply((peers) =>
      peers.map(
        (p) => pulumi.interpolate`[Peer]
PublicKey = ${p.publicKey}
AllowedIPs = ${pulumi.output(p.address).apply((a) => a.map((o) => `${o.address}/32`).join(", "))}
Endpoint = ${p.endpoint}
`,
      ),
    );

    output = pulumi.concat(
      output,
      pulumi.output(sections).apply((a) => a.join("\n")),
    );
  }

  return output;
}
