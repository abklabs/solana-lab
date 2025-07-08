import * as aws from "./aws";
import * as gcp from "./gcp";
import * as pulumi from "@pulumi/pulumi";
import * as types from "./types";
import * as spe from "./spe";
import * as vpn from "./vpn";

const coord = new vpn.Coordinator("coord");
let allNodes: types.Node[] = [];

function newMember(node: types.Node) {
  allNodes.push(node);

  const hub = coord.addHub(node);

  return new spe.Member(
    node.name,
    {
      connection: node.connection,
      privateIP: pulumi.output(hub.peer.address)[0].address,
    },
    {
      dependsOn: node,
    },
  );
}

const bootstrapNode = new aws.Node("aws-bootstrap");
const bootstrapMembership = newMember(bootstrapNode);

const node0 = new gcp.Node("gcp-node0");
const node0Membership = newMember(node0);

const node1 = new aws.Node("aws-node1");
const node1Membership = newMember(node1);

const hubSetup = coord.configureHubs();

spe.sendIt(bootstrapMembership, [node0Membership, node1Membership], {
  dependsOn: hubSetup,
});

export const nodes_name = allNodes.map((x) => x.name);
export const nodes_public_ip = allNodes.map((x) => x.connection.host);
export const nodes_private_key = allNodes.map((x) => x.connection.privateKey);
