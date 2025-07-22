Testing
-------

In order to test, you need to have `SOLANA_RPC_URL` exported from your environment, and both JSON-RPC and WS forwards in place, e.g.:

```
./ssh-to-host 0 -L8899:localhost:8899 -L8900:localhost:8900
```

To run the tests, run the following:

```
prove --ext .ts --ext .t test 
```

Note: There're currently warnings that will need to be cleaned up.

```
@tapjs/tsx may behave strangely when used along with
the @tapjs/typescript default plugin.

Please run: tap plugin rm @tapjs/typescript

bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
```
