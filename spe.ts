import * as pulumi from "@pulumi/pulumi";
import * as svmkit from "@svmkit/pulumi-svmkit";
import * as types from "./types";
import { Agave } from "./agave";
import { Firedancer } from "./fd";

export const networkInfo = {
  gossipPort: 8001,
  rpcPort: 8899,
  faucetPort: 9900,
};

const validatorConfig = new pulumi.Config("validator");
export const agaveVersion = validatorConfig.get("version") ?? "2.2.14-1";

export type MemberArgs = {
  connection: types.Connection;
  privateIP: pulumi.Output<string>;
};

export class Member extends pulumi.ComponentResource {
  name: string;
  connection: types.Connection;
  privateIP: pulumi.Output<string>;
  validatorKey: svmkit.KeyPair;
  voteAccountKey: svmkit.KeyPair;

  constructor(
    name: string,
    memberArgs: MemberArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("multi-kit:spe:member", name, {}, opts);

    const childInfo = pulumi.mergeOptions(opts, { parent: this });

    this.name = name;
    this.connection = memberArgs.connection;
    this.privateIP = memberArgs.privateIP;
    this.validatorKey = new svmkit.KeyPair(
      `${name}-validator-key`,
      {},
      childInfo,
    );
    this.voteAccountKey = new svmkit.KeyPair(
      `${name}-vote-account-key`,
      {},
      childInfo,
    );
  }
}

export type ValidatorArgs<V extends { variant?: any }> = {
  version?: string;
  runnerConfig?: pulumi.Input<svmkit.types.input.runner.ConfigArgs>;
  variant?: V["variant"];
};

export type ClusterArgs = {
  bootstrapMember: Member;
  validatorConfig?: ValidatorArgs<svmkit.validator.AgaveArgs>;
};

export class Cluster extends pulumi.ComponentResource {
  name: string;
  environment: svmkit.types.input.solana.EnvironmentArgs;
  childOpts: pulumi.ResourceOptions;
  bootstrapMember: Member;
  bootstrapValidator: Agave<Member>;
  entryPoint: pulumi.Output<string>[];
  knownValidator: pulumi.Output<string>[];
  expectedGenesisHash: pulumi.Output<string>;
  treasuryKey: svmkit.KeyPair;

  constructor(
    name: string,
    args: ClusterArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("spe:cluster", name, {}, opts);
    this.name = name;
    this.bootstrapMember = args.bootstrapMember;

    const validatorConfig = args.validatorConfig ?? {};

    const _ = types.nameMaker(name);

    this.environment = {
      rpcURL: this.bootstrapMember.privateIP.apply(
        (ip) => `http://${ip}:${networkInfo.rpcPort}`,
      ),
    };

    this.childOpts = pulumi.mergeOptions(opts, {
      parent: this,
      dependsOn: [this.bootstrapMember],
    });

    this.treasuryKey = new svmkit.KeyPair("treasury-key", {}, this.childOpts);

    const faucetKey = new svmkit.KeyPair("faucet-key", {}, this.childOpts);
    const stakeAccountKey = new svmkit.KeyPair(
      "stake-account-key",
      {},
      this.childOpts,
    );

    const addDepends = <T extends pulumi.Resource>(r: T) => {
      this.childOpts = pulumi.mergeOptions(this.childOpts, {
        dependsOn: [r],
      });

      return r;
    };

    const genesis = addDepends(
      new svmkit.genesis.Solana(
        _("genesis"),
        {
          runnerConfig: {
            packageConfig: {
              additional: ["svmkit-spl-token-cli"],
            },
          },
          connection: this.bootstrapMember.connection,
          version: agaveVersion,
          flags: {
            ledgerPath: "/home/sol/ledger",
            bootstrapValidators: [
              {
                identityPubkey: this.bootstrapMember.validatorKey.publicKey,
                votePubkey: this.bootstrapMember.voteAccountKey.publicKey,
                stakePubkey: stakeAccountKey.publicKey,
              },
            ],
            faucetPubkey: faucetKey.publicKey,
            bootstrapValidatorStakeLamports: 10000000000, // 10 SOL
            enableWarmupEpochs: true,
            slotsPerEpoch: 8192,
            clusterType: "development",
            faucetLamports: 1000,
            targetLamportsPerSignature: 0,
            inflation: "none",
            lamportsPerByteYear: 1,
          },
          primordial: [
            {
              pubkey: this.bootstrapMember.validatorKey.publicKey,
              lamports: 1000000000000, // 1000 SOL
            },
            {
              pubkey: this.treasuryKey.publicKey,
              lamports: 100000000000000, // 100000 SOL
            },
            {
              pubkey: faucetKey.publicKey,
              lamports: 1000000000000, // 1000 SOL
            },
          ],
        },
        this.childOpts,
      ),
    );

    this.entryPoint = [
      this.bootstrapMember.privateIP.apply(
        (v) => `${v}:${networkInfo.gossipPort}`,
      ),
    ];
    this.knownValidator = [this.bootstrapMember.validatorKey.publicKey];
    this.expectedGenesisHash = genesis.genesisHash;

    const rpcFaucetAddress = this.bootstrapMember.privateIP.apply(
      (ip) => `${ip}:${networkInfo.faucetPort}`,
    );

    addDepends(
      new svmkit.faucet.Faucet(
        _("faucet"),
        {
          connection: this.bootstrapMember.connection,
          keypair: faucetKey.json,
          flags: {
            perRequestCap: 1000,
          },
        },
        this.childOpts,
      ),
    );

    this.bootstrapValidator = addDepends(
      new Agave(
        _(`bootstrap-validator`),
        {
          member: this.bootstrapMember,
          variant: args.validatorConfig?.variant,
          environment: this.environment,
          runnerConfig: args.validatorConfig?.runnerConfig,
          flags: {
            onlyKnownRPC: false,
            rpcPort: networkInfo.rpcPort,
            dynamicPortRange: "8002-8020",
            privateRPC: false,
            gossipPort: networkInfo.gossipPort,
            rpcBindAddress: "0.0.0.0",
            walRecoveryMode: "skip_any_corrupted_record",
            limitLedgerSize: 50000000,
            blockProductionMethod: "central-scheduler",
            fullSnapshotIntervalSlots: 1000,
            noWaitForVoteToStartLeader: true,
            useSnapshotArchivesAtStartup: "when-newest",
            allowPrivateAddr: true,
            fullRpcAPI: true,
            noVoting: false,
            rpcFaucetAddress,
            gossipHost: this.bootstrapMember.privateIP,
            enableExtendedTxMetadataStorage: true,
            enableRpcTransactionHistory: true,
          },
          version: validatorConfig.version ?? agaveVersion,
          startupPolicy: {
            waitForRPCHealth: true,
          },
          timeoutConfig: {
            rpcServiceTimeout: 120,
          },
          shutdownPolicy: {
            force: true,
          },
          info: {
            name: this.bootstrapMember.name,
            details: "The SPE bootstrap validator.",
          },
        },
        this.childOpts,
      ),
    );
  }

  makeStakedVoteAccount(target: Member) {
    const _ = types.nameMaker(target.name);

    const childOpts = pulumi.mergeOptions(this.childOpts, {
      parent: target,
    });

    const transfer = new svmkit.account.Transfer(
      _("transfer"),
      {
        connection: this.bootstrapMember.connection,
        transactionOptions: {
          keyPair: this.treasuryKey.json,
        },
        amount: 100,
        recipientPubkey: target.validatorKey.publicKey,
        allowUnfundedRecipient: true,
      },
      childOpts,
    );
    const voteAccount = new svmkit.account.VoteAccount(
      _("voteAccount"),
      {
        connection: this.bootstrapMember.connection,
        keyPairs: {
          identity: target.validatorKey.json,
          voteAccount: target.voteAccountKey.json,
          authWithdrawer: this.treasuryKey.json,
        },
      },
      pulumi.mergeOptions(childOpts, { dependsOn: transfer }),
    );

    const stakeAccountKey = new svmkit.KeyPair(
      target.name + "-stakeAccount-key",
      {},
      childOpts,
    );
    return new svmkit.account.StakeAccount(
      _("stakeAccount"),
      {
        connection: this.bootstrapMember.connection,
        transactionOptions: {
          keyPair: this.treasuryKey.json,
        },
        keyPairs: {
          stakeAccount: stakeAccountKey.json,
          voteAccount: target.voteAccountKey.json,
        },
        amount: 10,
      },
      pulumi.mergeOptions(childOpts, { dependsOn: [voteAccount] }),
    );
  }

  addAgaveMember(
    member: Member,
    args: ValidatorArgs<svmkit.validator.AgaveArgs> = {},
    opts: pulumi.ResourceOptions = {},
  ) {
    const stake = this.makeStakedVoteAccount(member);
    const _ = types.nameMaker(member.name);

    opts = pulumi.mergeOptions(this.childOpts, opts);
    opts = pulumi.mergeOptions(opts, { parent: member });

    return new Agave(
      _(`validator`),
      {
        member: member,
        variant: args.variant,
        environment: this.environment,
        runnerConfig: args.runnerConfig,
        flags: {
          onlyKnownRPC: false,
          rpcPort: networkInfo.rpcPort,
          dynamicPortRange: "8002-8020",
          privateRPC: false,
          gossipPort: networkInfo.gossipPort,
          rpcBindAddress: "0.0.0.0",
          walRecoveryMode: "skip_any_corrupted_record",
          limitLedgerSize: 50000000,
          blockProductionMethod: "central-scheduler",
          fullSnapshotIntervalSlots: 1000,
          noWaitForVoteToStartLeader: true,
          useSnapshotArchivesAtStartup: "when-newest",
          allowPrivateAddr: true,
          fullRpcAPI: false,
          noVoting: false,
          gossipHost: member.privateIP,
          knownValidator: this.knownValidator,
          entryPoint: this.entryPoint,
          expectedGenesisHash: this.expectedGenesisHash,
        },
        version: args.version ?? agaveVersion,
        info: {
          name: member.name,
        },
      },
      pulumi.mergeOptions(opts, {
        dependsOn: [stake],
      }),
    );
  }

  addFiredancerMember(
    member: Member,
    args: ValidatorArgs<svmkit.validator.FiredancerArgs> = {},
    opts: pulumi.ResourceOptions = {},
  ) {
    const stake = this.makeStakedVoteAccount(member);
    const _ = types.nameMaker(member.name);

    opts = pulumi.mergeOptions(this.childOpts, opts);
    opts = pulumi.mergeOptions(opts, { parent: member });

    return new Firedancer(
      _(`validator`),
      {
        member: member,
        environment: this.environment,
        version: args.version,
        variant: args.variant,
        runnerConfig: args.runnerConfig,
        config: {
          user: "sol",
          gossip: {
            host: member.privateIP,
            entrypoints: this.entryPoint,
          },
          consensus: {
            identityPath: "/home/sol/validator-keypair.json",
            voteAccountPath: "/home/sol/vote-account-keypair.json",
            knownValidators: this.knownValidator,
            expectedGenesisHash: this.expectedGenesisHash,
          },
          ledger: {
            path: "/home/sol/ledger",
            accountsPath: "/home/sol/accounts",
          },
          rpc: {
            port: 8899,
            private: true,
          },
          log: {
            path: "-",
          },
          extraConfig: [
            `
[development.gossip]
allow_private_address = true

`,
          ],
        },
      },
      pulumi.mergeOptions(opts, {
        dependsOn: [stake],
      }),
    );
  }
}
