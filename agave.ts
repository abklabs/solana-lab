import * as pulumi from "@pulumi/pulumi";
import * as svmkit from "@svmkit/pulumi-svmkit";
import { networkInfo, type Member } from "./spe";
import { type Optional, nameMaker } from "./types";

const agaveConfig = new pulumi.Config("agave");

export type AgaveArgs<M extends Member> = Optional<
  svmkit.validator.AgaveArgs,
  "connection" | "keyPairs"
> & {
  member: M;
};

export class Agave<M extends Member> extends pulumi.ComponentResource {
  member: M;
  constructor(
    name: string,
    args: AgaveArgs<M>,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("validator:agave", name, {}, opts);
    this.member = args.member;

    let childOpts = pulumi.mergeOptions(opts, {
      parent: this,
      dependsOn: [],
    });

    const _ = nameMaker(name);

    const agaveArgs = {
      ...args,
      connection: args.connection ?? this.member.connection,
      keyPairs: args.keyPairs ?? {
        identity: this.member.validatorKey.json,
        voteAccount: this.member.voteAccountKey.json,
      },
    };

    const addDepends = (...dependsOn: pulumi.Resource[]) => {
      childOpts = pulumi.mergeOptions(childOpts, {
        dependsOn,
      });
    };

    const tunerVariant =
      agaveConfig.get<svmkit.tuner.TunerVariant>("tunerVariant") ??
      svmkit.tuner.TunerVariant.Generic;

    const tunerParams = svmkit.tuner.getDefaultTunerParamsOutput({
      variant: tunerVariant,
    });

    addDepends(
      new svmkit.tuner.Tuner(
        _("tuner"),
        {
          connection: this.member.connection,
          params: tunerParams.apply((p) => ({
            cpuGovernor: p.cpuGovernor,
            kernel: p.kernel,
            net: p.net,
            vm: p.vm,
            fs: p.fs,
          })),
        },
        childOpts,
      ),
    );

    const firewallParams = svmkit.firewall.getDefaultFirewallParamsOutput({
      variant: svmkit.firewall.FirewallVariant.Generic,
    });

    addDepends(
      new svmkit.firewall.Firewall(
        _("firewall"),
        {
          connection: this.member.connection,
          params: firewallParams.apply((f) => ({
            allowPorts: [
              ...(f.allowPorts ?? []),
              "8000:8020/tcp",
              "8000:8020/udp",
              "8900/tcp",
              "55121/udp",
              networkInfo.gossipPort.toString(),
              networkInfo.rpcPort.toString(),
              networkInfo.faucetPort.toString(),
            ],
          })),
        },
        childOpts,
      ),
    );

    addDepends(
      new svmkit.validator.Agave(_("validator"), agaveArgs, childOpts),
    );
  }
}
