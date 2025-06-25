import * as pulumi from "@pulumi/pulumi";
import * as svmkit from "@svmkit/pulumi-svmkit";
import * as types from "./types";

const gossipPort = 8001;
const rpcPort = 8899;
const faucetPort = 9900;

const faucetKey = new svmkit.KeyPair("faucet-key");
const treasuryKey = new svmkit.KeyPair("treasury-key");
const stakeAccountKey = new svmkit.KeyPair("stake-account-key");

const validatorConfig = new pulumi.Config("validator");
const firewallConfig = new pulumi.Config("firewall");
export const agaveVersion = validatorConfig.get("version") ?? "2.2.14-1";

const runnerConfig = {};

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

// Firewall setup
const firewallVariant =
  firewallConfig.get<svmkit.firewall.FirewallVariant>("variant") ??
  svmkit.firewall.FirewallVariant.Generic;

// Retrieve the default firewall parameters for that variant
const genericFirewallParamsOutput =
  svmkit.firewall.getDefaultFirewallParamsOutput({
    variant: firewallVariant,
  });

// "Apply" those params so we can pass them to the Firewall constructor
const firewallParams = genericFirewallParamsOutput.apply((f) => ({
  allowPorts: [
    ...(f.allowPorts ?? []),
    "8000:8020/tcp",
    "8000:8020/udp",
    "8900/tcp",
    "55121/udp",
    gossipPort.toString(),
    rpcPort.toString(),
    faucetPort.toString(),
  ],
}));

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
    this.name = name;
    this.connection = memberArgs.connection;
    this.privateIP = memberArgs.privateIP;
    this.validatorKey = new svmkit.KeyPair(`${name}-validator-key`, {}, opts);
    this.voteAccountKey = new svmkit.KeyPair(
      `${name}-vote-account-key`,
      {},
      opts,
    );
  }
}

export function sendIt(
  bootstrapNode: Member,
  nodes: Member[],
  opts: pulumi.ComponentResourceOptions = {},
) {
  const allNodes = [bootstrapNode, ...nodes];

  allNodes.forEach((node) => {
    // Create the Firewall resource on the EC2 instance
    new svmkit.firewall.Firewall(
      `${node.name}-firewall`,
      {
        connection: bootstrapNode.connection,
        params: firewallParams,
      },
      {
        parent: node,
        dependsOn: [node],
      },
    );
  });

  // Tuner setup
  const tunerVariant =
    tunerConfig.get<svmkit.tuner.TunerVariant>("variant") ??
    svmkit.tuner.TunerVariant.Generic;

  // Retrieve the default tuner parameters for that variant
  const genericTunerParamsOutput = svmkit.tuner.getDefaultTunerParamsOutput({
    variant: tunerVariant,
  });

  // "Apply" those params so we can pass them to the Tuner constructor
  const tunerParams = genericTunerParamsOutput.apply((p) => ({
    cpuGovernor: p.cpuGovernor,
    kernel: p.kernel,
    net: p.net,
    vm: p.vm,
    fs: p.fs,
  }));

  // Create the Tuner resource on the EC2 instance
  const tuner = new svmkit.tuner.Tuner(
    "tuner",
    {
      connection: bootstrapNode.connection,
      params: tunerParams,
    },
    {
      dependsOn: [bootstrapNode],
    },
  );

  const genesis = new svmkit.genesis.Solana(
    "genesis",
    {
      connection: bootstrapNode.connection,
      version: agaveVersion,
      flags: {
        ledgerPath: "/home/sol/ledger",
        bootstrapValidators: [
          {
            identityPubkey: bootstrapNode.validatorKey.publicKey,
            votePubkey: bootstrapNode.voteAccountKey.publicKey,
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
          pubkey: bootstrapNode.validatorKey.publicKey,
          lamports: 1000000000000, // 1000 SOL
        },
        {
          pubkey: treasuryKey.publicKey,
          lamports: 100000000000000, // 100000 SOL
        },
        {
          pubkey: faucetKey.publicKey,
          lamports: 1000000000000, // 1000 SOL
        },
      ],
    },
    pulumi.mergeOptions(opts, {
      dependsOn: [bootstrapNode],
    }),
  );

  const environment = {
    rpcURL: bootstrapNode.privateIP.apply((ip) => `http://${ip}:${rpcPort}`),
  };

  const rpcFaucetAddress = bootstrapNode.privateIP.apply(
    (ip) => `${ip}:${faucetPort}`,
  );

  const baseFlags: svmkit.types.input.agave.FlagsArgs = {
    onlyKnownRPC: false,
    rpcPort,
    dynamicPortRange: "8002-8020",
    privateRPC: false,
    gossipPort,
    rpcBindAddress: "0.0.0.0",
    walRecoveryMode: "skip_any_corrupted_record",
    limitLedgerSize: 50000000,
    blockProductionMethod: "central-scheduler",
    fullSnapshotIntervalSlots: 1000,
    noWaitForVoteToStartLeader: true,
    useSnapshotArchivesAtStartup: "when-newest",
    allowPrivateAddr: true,
    rpcFaucetAddress,
  };

  const bootstrapFlags: svmkit.types.input.agave.FlagsArgs = {
    ...baseFlags,
    fullRpcAPI: true,
    noVoting: false,
    gossipHost: bootstrapNode.privateIP,
    enableExtendedTxMetadataStorage: true,
    enableRpcTransactionHistory: true,
  };

  const faucet = new svmkit.faucet.Faucet(
    "bootstrap-faucet",
    {
      connection: bootstrapNode.connection,
      keypair: faucetKey.json,
      flags: {
        perRequestCap: 1000,
      },
    },
    {
      dependsOn: [genesis],
    },
  );

  const bootstrapValidator = new svmkit.validator.Agave(
    `bootstrap-validator`,
    {
      environment,
      runnerConfig,
      connection: bootstrapNode.connection,
      version: agaveVersion,
      startupPolicy: {
        waitForRPCHealth: true,
      },
      timeoutConfig: {
        rpcServiceTimeout: 120,
      },
      shutdownPolicy: {
        force: true,
      },
      keyPairs: {
        identity: bootstrapNode.validatorKey.json,
        voteAccount: bootstrapNode.voteAccountKey.json,
      },
      flags: bootstrapFlags,
      info: {
        name: bootstrapNode.name,
        details: "The SPE bootstrap validator.",
      },
    },
    {
      dependsOn: [bootstrapNode, faucet],
    },
  );

  nodes.forEach((node) => {
    const otherNodes = allNodes.filter((x) => x != node);
    const entryPoint = otherNodes.map((node) =>
      node.privateIP.apply((v) => `${v}:${gossipPort}`),
    );
    const _ = (...x: string[]) => [node.name, ...x].join("-");

    const tuner = new svmkit.tuner.Tuner(
      _("tuner"),
      {
        connection: node.connection,
        params: tunerParams,
      },
      {
        dependsOn: [node],
      },
    );

    const flags: svmkit.types.input.agave.FlagsArgs = {
      ...baseFlags,
      entryPoint,
      knownValidator: otherNodes.map((x) => x.validatorKey.publicKey),
      expectedGenesisHash: genesis.genesisHash,
      fullRpcAPI: node == bootstrapNode,
      gossipHost: node.privateIP,
    };

    new svmkit.validator.Agave(
      _("validator"),
      {
        environment,
        runnerConfig,
        connection: node.connection,
        version: agaveVersion,
        shutdownPolicy: {
          force: true,
        },
        keyPairs: {
          identity: node.validatorKey.json,
          voteAccount: node.voteAccountKey.json,
        },
        flags,
        info: {
          name: node.name,
          details: "A validator node on the SPE.",
        },
      },
      {
        dependsOn: [tuner, bootstrapValidator],
      },
    );

    const transfer = new svmkit.account.Transfer(
      _("transfer"),
      {
        connection: bootstrapNode.connection,
        transactionOptions: {
          keyPair: treasuryKey.json,
        },
        amount: 100,
        recipientPubkey: node.validatorKey.publicKey,
        allowUnfundedRecipient: true,
      },
      {
        dependsOn: [bootstrapValidator],
      },
    );
    const voteAccount = new svmkit.account.VoteAccount(
      _("voteAccount"),
      {
        connection: bootstrapNode.connection,
        keyPairs: {
          identity: node.validatorKey.json,
          voteAccount: node.voteAccountKey.json,
          authWithdrawer: treasuryKey.json,
        },
      },
      {
        dependsOn: [transfer],
      },
    );

    const stakeAccountKey = new svmkit.KeyPair(node.name + "-stakeAccount-key");
    new svmkit.account.StakeAccount(
      _("stakeAccount"),
      {
        connection: bootstrapNode.connection,

        transactionOptions: {
          keyPair: treasuryKey.json,
        },
        keyPairs: {
          stakeAccount: stakeAccountKey.json,
          voteAccount: node.voteAccountKey.json,
        },
        amount: 10,
      },
      {
        dependsOn: [voteAccount],
      },
    );
  });
}
