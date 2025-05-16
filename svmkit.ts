import * as pulumi from "@pulumi/pulumi";
import * as svmkit from "@svmkit/pulumi-svmkit";

import * as types from "./types";

export const gossipPort = 8001;
export const rpcPort = 8899;
export const faucetPort = 9900;

const tunerConfig = new pulumi.Config("tuner");

const tunerVariant =
  tunerConfig.get<svmkit.tuner.TunerVariant>("variant") ??
  svmkit.tuner.TunerVariant.Generic;

const genericTunerParamsOutput = svmkit.tuner.getDefaultTunerParamsOutput({
  variant: tunerVariant,
});

const tunerParams = genericTunerParamsOutput.apply((p) => ({
  cpuGovernor: p.cpuGovernor,
  kernel: p.kernel,
  net: p.net,
  vm: p.vm,
  fs: p.fs,
}));

export type AgaveArgs = {
  node: types.Node;
  agaveFlags: svmkit.types.input.agave.FlagsArgs;
};

export class Agave extends pulumi.ComponentResource {
  constructor(
    name: string,
    nodeArgs: AgaveArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("multi-kit:agave:validator", name, {}, opts);

    const conn = nodeArgs.node.connection;

    let childInfo = pulumi.mergeOptions(opts, {
      parent: this,
      dependsOn: [nodeArgs.node],
    });

    const tuner = new svmkit.tuner.Tuner(
      "tuner",
      {
        connection: conn,
        params: tunerParams,
      },
      childInfo,
    );

    childInfo = pulumi.mergeOptions(opts, { dependsOn: [tuner] });
  }
}
