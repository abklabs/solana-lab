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

const bootstrap = newMember(new aws.Node("aws-bootstrap"));
const node0 = newMember(new gcp.Node("node0"));
const node1 = newMember(
  new aws.Node("node1", {
    instanceType: "r7a.8xlarge",
  }),
);

const hubSetup = coord.configureHubs();

const clstr = new spe.Cluster(
  "cluster",
  {
    bootstrapMember: bootstrap,
  },
  {
    dependsOn: hubSetup,
  },
);

clstr.addAgaveMember(node0);
clstr.addFiredancerMember(node1);

export const nodes_name = allNodes.map((x) => x.name);
export const nodes_public_ip = allNodes.map((x) => x.connection.host);
export const nodes_private_key = allNodes.map((x) => x.connection.privateKey);

export const speInfo = {
  treasuryKey: clstr.treasuryKey.json,
  bootstrap: {
    connection: clstr.bootstrapMember.connection,
  },
};
