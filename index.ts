import * as aws from "./aws";
import * as gcp from "./gcp";
import * as wireguard from "./wireguard";
import * as pulumi from "@pulumi/pulumi";
import * as types from "./types";
import * as spe from "./spe";

let addrCount = 0;

function createPeer(node: types.Node) {
  addrCount += 1;
  return new wireguard.Peer(
    `${node.name}-wg-peer`,
    {
      connection: node.connection,
      listenPort: wireguard.info.publicPort,
      address: [{ address: `10.0.0.${addrCount}`, netmask: 24 }],
      endpoint: pulumi
        .output(node.connection.host)
        .apply((h) => `${h}:${wireguard.info.publicPort}`),
    },
    {
      parent: node,
      dependsOn: node,
    },
  );
}

let allNodes: types.Node[] = [];
let wgPeers: wireguard.Peer[] = [];

const bootstrapNode = new aws.Node("aws-bootstrap");
allNodes.push(bootstrapNode);

const bootstrapPeer = createPeer(bootstrapNode);
wgPeers.push(bootstrapPeer);

const bootstrapMember = new spe.Member("bootstrap", {
  connection: bootstrapNode.connection,
  privateIP: pulumi.output(bootstrapPeer.address)[0].address,
});

const node0 = new gcp.Node("gcp-node0");
allNodes.push(node0);
const node0peer = createPeer(node0);
wgPeers.push(node0peer);

const node0Member = new spe.Member("node0", {
  connection: node0.connection,
  privateIP: pulumi.output(node0peer.address)[0].address,
});

const node1 = new aws.Node("aws-node1");
allNodes.push(node1);
const node1peer = createPeer(node1);
wgPeers.push(node1peer);

const node1Member = new spe.Member("node1", {
  connection: node1.connection,
  privateIP: pulumi.output(node1peer.address)[0].address,
});

const wgMeshSetup = wgPeers.map((p) =>
  p.setupHost(...wgPeers.filter((x) => x !== p)),
);

spe.sendIt(bootstrapMember, [node0Member, node1Member], {
  dependsOn: wgMeshSetup,
});

export const nodes_name = allNodes.map((x) => x.name);
export const nodes_public_ip = allNodes.map((x) => x.connection.host);
export const nodes_private_key = allNodes.map((x) => x.connection.privateKey);
