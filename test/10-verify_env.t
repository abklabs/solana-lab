#!/usr/bin/env opsh

lib::import test-harness

check-cli-validators-output () {
    [[ -v SOLANA_RPC_URL ]] || testing::fail "SOLANA_RPC_URL must be set in the environment for tests to run"

    local tmpfile=$(temp::file)
    solana -u "$SOLANA_RPC_URL" validators | grep "Active Stake" > /dev/null || testing::fail "did not get the expected CLI output"
}

testing::register check-cli-validators-output "verify we can get a validator list from the cluster"
testing::run
