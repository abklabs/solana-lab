import * as types from "./types";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as tls from "@pulumi/tls";
import * as svmkit from "@svmkit/pulumi-svmkit";
import * as wireguard from "./wireguard";

const adminUsername = "admin";
const machineType = "c4-standard-8";
const osImage = "debian-12";

const network = new gcp.compute.Network("network", {
  autoCreateSubnetworks: false,
});

const subnet = new gcp.compute.Subnetwork("subnet", {
  ipCidrRange: "10.0.1.0/24",
  network: network.id,
});

const firewall = new gcp.compute.Firewall("firewall", {
  network: network.selfLink,
  allows: [
    {
      protocol: "tcp",
      ports: ["22"],
    },
    {
      protocol: "udp",
      ports: [`${wireguard.info.publicPort}`],
    },
  ],
  direction: "INGRESS",
  sourceRanges: ["0.0.0.0/0"],
  targetTags: [],
});

export type NodeArgs = {};

export class Node extends pulumi.ComponentResource implements types.Node {
  name: string;
  instance: gcp.compute.Instance;
  connection: svmkit.types.input.ssh.ConnectionArgs;

  constructor(
    name: string,
    nodeArgs: NodeArgs = {},
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("multi-kit:gcp:node", name, {}, opts);
    this.name = name;

    const n = (...p: string[]) => [this.name, ...p].join("-");

    const childInfo = pulumi.mergeOptions(opts, {
      parent: this,
    });

    const sshKey = new tls.PrivateKey(
      n("ssh-key"),
      {
        algorithm: "ED25519",
      },
      childInfo,
    );

    this.instance = new gcp.compute.Instance(
      n("instance"),
      {
        machineType,
        bootDisk: {
          initializeParams: {
            image: osImage,
            size: 256,
          },
        },
        networkInterfaces: [
          {
            network: network.id,
            subnetwork: subnet.id,
            accessConfigs: [{}],
          },
        ],
        serviceAccount: {
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        },
        allowStoppingForUpdate: true,
        tags: [],
        metadata: {
          "enable-oslogin": "false",
          "ssh-keys": sshKey.publicKeyOpenssh.apply((k) => `admin:${k}`),
        },
      },
      pulumi.mergeOptions(opts, {
        ...childInfo,
        dependsOn: [subnet, firewall],
      }),
    );

    const publicIP = this.instance.networkInterfaces.apply((interfaces) => {
      return interfaces[0].accessConfigs![0].natIp;
    });

    this.connection = {
      host: publicIP,
      user: adminUsername,
      privateKey: sshKey.privateKeyOpenssh,
      dialErrorLimit: 50,
    };
  }
}
