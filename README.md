Solana Lab
==========

An easy-to-hack on pluggable Solana sandbox.  By default this creates a 3 node cluster, operating in AWS and GCP, using [WireGuard](https://www.wireguard.com) as the network overlay to privately connect the cluster.  It can be modified to be used with bare metal, or any other configuration you might need.


0. Have `pulumi` installed, logged in to wherever you're storing state, and configured to work with AWS and GCP.

- https://www.pulumi.com/docs/iac/cli/commands/pulumi_login/
- https://github.com/pulumi/pulumi-aws?tab=readme-ov-file#configuration
- https://github.com/pulumi/pulumi-gcp?tab=readme-ov-file#google-cloud-platform-resource-provider


1. Install the required Pulumi components and SDK

```
pulumi install
```


2. Create and select a Pulumi stack

```
pulumi stack init dev
```

3. Run `pulumi up`

```
pulumi up
```

... results in:

```
Previewing update (dev)

.
.
.

Do you want to perform this update? yes
Updating (dev)

View in Browser (Ctrl+O): https://app.pulumi.com/someuser/solana-lab/dev/updates/1

     Type                                     Name                                    Plan       Info
 +   pulumi:pulumi:Stack                      svmkit-wireguard-playground-test-ideas  create     2 messages
 +   ├─ multi-kit:gcp:node                    node0                                   create     
 +   │  ├─ tls:index:PrivateKey               node0-ssh-key                           create     
 +   │  ├─ gcp:compute:Instance               node0-instance                          create     
 +   │  └─ svmkit:machine:Machine             node0-machine                           create     
 +   ├─ vpn:coordinator                       coord                                   create     
 +   │  ├─ vpn:hub                            node1                                   create     
 +   │  │  ├─ pulumi-nodejs:dynamic:Resource  node1-keyPair                           create     
 +   │  │  └─ wireguard:peer                  node1-peer                              create     
 +   │  │     └─ command:remote:Command       node1-peer-setup                        create     
 +   │  ├─ vpn:hub                            node0                                   create     

.
.
.

Outputs:
    nodes: [
        ...
    ]

```

4. Verify that the network is online

```
./ssh-to-host 0 solana validators
```

... results in:

```
   Identity                                      Vote Account                            Commission  Last Vote        Root Slot     Skip Rate  Credits  Version            Active Stake
  BS2NoJXRyPoqpUiVZBzk7gEyvcjwConwf3m15ydgVvth  2JKoGwTLuYcSCM4US5czTxnNCFt7uHmZY4SysJTTFPDF  100%        493 (  0)        462 (  0)    -         240  0.603.20216         1.475144901 SOL (11.39%)
  3VPeNB6C75EzRaFzPL4vrAn2FPeVFJbQBwaXv5nCtzst  6mx4RyiA4j8FMpyRgPXnf9yc1WZmVWCTBwys4k6mhSfg  100%        493 (  0)        462 (  0)   0.00%      240   2.2.14         1.475144901 SOL (11.39%)
  FQQ2UW9smcZK8AVHwhUW1PzLv8KFdBFydrMacqi4fhJk  3s1HU7px97Bv3DTpcAReDA5uj9wgCk6yNBhkWu8KL2Fp  100%        493 (  0)        462 (  0)   0.00%      240   2.2.14         9.999999344 SOL (77.22%)

Average Stake-Weighted Skip Rate: 0.00%
Average Unweighted Skip Rate:     0.00%

Active Stake: 12.950289146 SOL

Stake By Version:
2.2.14  -    2 current validators (88.61%)
0.603.20216 -    1 current validators (11.39%)
```

5. Interact with the cluster

At this point, you can proxy into the remote RPC node, and interact with the Solana network:

```
./ssh-to-host 0 -L 8899:localhost:8899
```

... and then in another terminal, you can locally run:

```
solana -u http://localhost:8899 validators
```

... and see the state of the network.


6. (Optional) Tear down the example

```
pulumi down
```
