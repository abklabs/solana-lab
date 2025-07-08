import * as pulumi from "@pulumi/pulumi";
import * as svmkit from "@svmkit/pulumi-svmkit";
import { networkInfo, type Member } from "./spe";
import { type Optional, nameMaker } from "./types";

const firedancerConfig = new pulumi.Config("firedancer");

export type FiredancerArgs<M extends Member> = Optional<
  svmkit.validator.FiredancerArgs,
  "connection" | "keyPairs"
> & {
  member: M;
};

export class Firedancer<M extends Member> extends pulumi.ComponentResource {
  member: M;
  constructor(
    name: string,
    args: FiredancerArgs<M>,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("validator:firedancer", name, {}, opts);
    this.member = args.member;

    let childOpts = pulumi.mergeOptions(opts, {
      parent: this,
      dependsOn: [],
    });

    const _ = nameMaker(name);

    const firedancerArgs = {
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
              "8900:8915/udp",
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
      new svmkit.validator.Firedancer(
        _("validator"),
        firedancerArgs,
        childOpts,
      ),
    );
  }
}
