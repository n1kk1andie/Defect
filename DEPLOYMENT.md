# Branch Defects Register — GICT Linux deployment

This app packages into a **self-contained bundle** that runs on a plain Linux
box with nothing but Node.js installed — no `npm install`, no internet access
at runtime, no Vercel.

## 1. Build the bundle (on any machine with Node + npm)

```bash
./deploy/package.sh
```

This produces **`dist/vmbs-defect.zip`**. It contains the compiled app, a minimal
`node_modules`, and `server.js` (the Next.js standalone server). Copy that one
zip to the GICT server.

> The build uses Next.js *standalone* output. `deploy/package.sh` sets
> `BUILD_STANDALONE=1`; ordinary Vercel/`npm run build` behaviour is unchanged.

## 2. Install on the GICT server

Requires **Node.js 18+** (Node 20 LTS recommended).

```bash
sudo mkdir -p /opt/vmbs-defect
sudo unzip vmbs-defect.zip -d /tmp/pkg
sudo cp -r /tmp/pkg/vmbs-defect/. /opt/vmbs-defect/
sudo useradd --system --home /opt/vmbs-defect vmbsapp 2>/dev/null || true
sudo chown -R vmbsapp:vmbsapp /opt/vmbs-defect
```

Quick test (foreground):

```bash
cd /opt/vmbs-defect && PORT=3003 HOSTNAME=127.0.0.1 node server.js
# then browse http://127.0.0.1:3003
```

## 3. Run as a service

```bash
sudo cp /opt/vmbs-defect/vmbs-defect.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vmbs-defect
sudo systemctl status vmbs-defect
```

## 4. Reverse proxy + TLS (recommended)

The service listens on `127.0.0.1:3003` only. Put nginx in front for TLS and
a friendly hostname — see `nginx.conf.example`.

## 5. Environment / configuration

Set any secrets as `Environment=` lines in the systemd unit (or an
`EnvironmentFile=`). If the repo ships a `.env.example`, use it as the reference
list of supported variables. Cloud blob-storage variables
(`BLOB_READ_WRITE_TOKEN`, `AZURE_STORAGE_CONNECTION_STRING`) are **optional** —
without them the app uses its on-device / uploaded-file behaviour, which is the
normal mode for a self-hosted box.

## 6. Updating

Rebuild the zip, stop the service, replace `/opt/vmbs-defect`, start the service:

```bash
sudo systemctl stop vmbs-defect
sudo rm -rf /opt/vmbs-defect && sudo mkdir -p /opt/vmbs-defect
sudo unzip -o vmbs-defect.zip -d /tmp/pkg && sudo cp -r /tmp/pkg/vmbs-defect/. /opt/vmbs-defect/
sudo chown -R vmbsapp:vmbsapp /opt/vmbs-defect
sudo systemctl start vmbs-defect
```
