import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as tls from "@pulumi/tls";
import * as svmkit from "@svmkit/pulumi-svmkit";
import * as types from "./types";
import * as wireguard from "./wireguard";

const adminUsername = "admin";
const instanceType = "t3.2xlarge";
const instanceArch = "x86_64";

const ami = pulumi.output(
  aws.ec2.getAmi({
    filters: [
      {
        name: "name",
        values: ["debian-12-*"],
      },
      {
        name: "architecture",
        values: [instanceArch],
      },
    ],
    owners: ["136693071363"], // Debian
    mostRecent: true,
  }),
);

const securityGroup = new aws.ec2.SecurityGroup("security-group", {
  description: "Allow SSH and specific inbound traffic",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["0.0.0.0/0"],
    },
    {
      protocol: "udp",
      fromPort: wireguard.info.publicPort,
      toPort: wireguard.info.publicPort,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

export type NodeArgs = {};

export class Node extends pulumi.ComponentResource implements types.Node {
  name: string;
  instance: aws.ec2.Instance;
  connection: svmkit.types.input.ssh.ConnectionArgs;

  constructor(
    name: string,
    nodeArgs: NodeArgs = {},
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("multi-kit:aws:node", name, {}, opts);
    this.name = name;

    const n = (...p: string[]) => [this.name, ...p].join("-");

    const userData = `#!/bin/bash
mkfs -t ext4 /dev/sdf
mkfs -t ext4 /dev/sdg
mkdir -p /home/sol/accounts
mkdir -p /home/sol/ledger
cat <<EOF >> /etc/fstab
/dev/sdf	/home/sol/accounts	ext4	defaults	0	0
/dev/sdg	/home/sol/ledger	ext4	defaults	0	0
EOF
systemctl daemon-reload
mount -a
`;

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

    const keyPair = new aws.ec2.KeyPair(
      n("keypair"),
      {
        publicKey: sshKey.publicKeyOpenssh,
      },
      childInfo,
    );

    this.instance = new aws.ec2.Instance(
      n("instance"),
      {
        ami: ami.id,
        instanceType,
        keyName: keyPair.keyName,
        vpcSecurityGroupIds: [securityGroup.id],
        ebsBlockDevices: [
          {
            deviceName: "/dev/sdf",
            volumeSize: 500,
            volumeType: "io2",
            iops: 16000,
          },
          {
            deviceName: "/dev/sdg",
            volumeSize: 1024,
            volumeType: "io2",
            iops: 16000,
          },
        ],
        userData,
        tags: {
          Name: `${pulumi.getStack()}-${this.name}`,
        },
      },
      childInfo,
    );

    this.connection = {
      host: this.instance.publicDns,
      user: adminUsername,
      privateKey: sshKey.privateKeyOpenssh,
    };
  }
}
