import * as svmkit from "@svmkit/pulumi-svmkit";
import * as pulumi from "@pulumi/pulumi";

export type Connection = svmkit.types.input.ssh.ConnectionArgs;

export interface Node extends pulumi.ComponentResource {
  name: string;
  connection: Connection;
}

export function nameMaker(name: string) {
  return (...p: string[]) => [name, ...p].join("-");
}
