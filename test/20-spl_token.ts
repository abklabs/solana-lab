#!/usr/bin/env -S pnpm tsx

import { default as t } from "tap";
import { LAMPORTS_PER_SOL, Connection, Keypair } from "@solana/web3.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

// Mock these to not break the TAP protocol
const consoleMock = (message?: any, ...optionalParams: any[]) =>
  t.comment(message, ...optionalParams);
console.error = consoleMock;
console.log = consoleMock;
console.debug = consoleMock;
console.info = consoleMock;
console.warn = consoleMock;

const solanaRPCURL = process.env.SOLANA_RPC_URL;

if (solanaRPCURL === undefined) {
  throw new Error("SOLANA_RPC_URL must be defined for this test to work");
}

const payer = new Keypair();

t.comment(`using payer public key ${payer.publicKey}`);
const connection = new Connection(solanaRPCURL, "confirmed");

t.test("airdrop", async (t) => {
  const reqSol = 1 * LAMPORTS_PER_SOL;
  const airdropTx = await connection.requestAirdrop(payer.publicKey, reqSol);

  t.ok(airdropTx, "airdrop succeeded");

  const latestBlockHash = await connection.getLatestBlockhash();

  await connection.confirmTransaction({
    blockhash: latestBlockHash.blockhash,
    lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    signature: airdropTx,
  });

  const balance = await connection.getBalance(payer.publicKey);
  t.comment(`balance is ${balance}`);
  t.equal(balance, reqSol);
});

t.test("mint token", async (t) => {
  const decimals = 6;
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    decimals,
  );

  let tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
  );

  t.equal(
    tokenAccount.amount,
    BigInt(0),
    "make sure the mint account is empty",
  );

  const amountToMint = 1000000 * Math.pow(10, decimals);
  t.ok(
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount.address,
      payer.publicKey,
      amountToMint,
    ),
    "verify token was minted properly",
  );

  tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
  );

  t.equal(
    tokenAccount.amount,
    BigInt(amountToMint),
    "check that tokens were minted properly",
  );

  t.end();
});
