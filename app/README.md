# TEST Curve local panel

Run the page from the repository root:

```powershell
node scripts/serve-app.js
```

Open `http://localhost:4173` in a browser with an EVM wallet extension. Import the
test wallet only into a dedicated testnet-only wallet profile, select Robinhood Chain
Testnet (chain ID 46630), then use **Cüzdan bağla**.

The panel reads the public RPC directly. It never receives, stores, or transmits a
private key. Every write action opens the connected wallet's normal transaction
confirmation UI.
