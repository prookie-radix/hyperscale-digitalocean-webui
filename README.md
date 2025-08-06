# DISCLAIMER

This script is provided "as is" without any warranties or guarantees of any kind. 
By using this script, you acknowledge that you are solely responsible for any consequences, 
damages, or issues that may arise from its usage.

The author(s) of this script assume no responsibility or liability for any loss of data, 
system failure, downtime, security breaches, or other consequences that may result 
from running this script. Use this script at your own risk.

You should thoroughly test this script in a safe, non-production environment before using it in any live systems.

Make sure to regularly check your Digitalocean account for droplets that you do not want to run anymore
to avoid unexpected costs.

---

> [!IMPORTANT]
> ## Publicly accessible instance
> Visit https://prookie-radix.github.io/hyperscale-digitalocean-webui/

## Self-hosting

Easy: just throw this repository on your web server (really only `index.html`, `app.js` and `cloud-init.txt`).

## Todos

- [x] Public instance of web UI
- [ ] Load some stats from running nodes (shard number, TPS, finality, etc.)
  - [ ] Set up a centralized proxy server (required because of CORS)
  - [ ] Make node stat aggregation opt-in
- [ ] Deletion of specific nodes
- [ ] Auto-refresh of node list
- [ ] Load regions and droplet sizes dynamically
- [ ] Check in realtime if jar and config file are available under given base URL
- [ ] Improve docs
