class ApiState {
    static Unknown = new ApiState('Unknown');
    static Evaluating = new ApiState('Evaluating');
    static Ok = new ApiState('Ok');
    static Unauthenticated = new ApiState('Unauthenticated');

    constructor(name) {
        this.name = name;
    }
    toString() {
        return `ApiState.${this.name}`;
    }
    equals(state) {
        if(!state instanceof ApiState) {
            return false;
        }
        return this.toString() === state.toString();
    }
}

class BasePlatform {
    checkAccess() {
        throw new Error('fetchData() not implemented');
    };
    getActiveNodes() {
        throw new Error('getActiveNodes() not implemented');
    };

    deleteAllActiveNodes() {
        throw new Error('deleteAllActiveNodes() not implemented');
    };

    createNodes(region, size, quantity) {
        throw new Error('createNodes() not implemented');
    };

    getCosts() {
        throw new Error('getCosts() not implemented');
    };
}

/**
 * DO api key needs at least the following access rights/scopes:
 * - droplet: create & delete
 * - ssh_key: read
 * - tag: create
 */
class DigitalOceanPlatform extends BasePlatform {
    dropletTag = 'radix-hyperscale';
    dots = null;

    constructor(apiKey) {
        super();

        this.dots = window.dots.createApiClient({token: apiKey});
    };

    async checkAccess() {
        const input = {
            per_page: 1,
            tag_name: this.dropletTag,
        };
        const data = await this.dots.droplet.listDroplets(input);
        console.log('API checkAccess: droplet.listDroplets = ', data);
        return true;
    };

    async getActiveNodes() {
        const currencyFormatter = getCurrencyFormatter();

        const input = {
            per_page: 500,
            tag_name: this.dropletTag,
        };
        const {data: {droplets}} = await this.dots.droplet.listDroplets(input);

        // console.log(droplets);

        return droplets.map(droplet => {
            const ipPublic = droplet.networks.v4.filter(network => network.type === 'public').map(network => network.ip_address)?.[0];

            return {
                'name': droplet.name,
                'memory': droplet.memory,
                'memory_formatted': droplet.memory / 1024 + ' GB', // @TODO: correct unit handling
                'vcpus': droplet.vcpus,
                'disk': droplet.disk,
                'disk_formatted': droplet.disk + ' GB', // @TODO: correct unit handling
                'status': droplet.status,
                'created_at': droplet.created_at,
                'image': droplet.image.slug,
                'price_hourly': droplet.size.price_hourly,
                'price_hourly_formatted': currencyFormatter.format(droplet.size.price_hourly),
                'price_monthly': droplet.size.price_monthly,
                'price_monthly_formatted': currencyFormatter.format(droplet.size.price_monthly),
                'size': droplet.size.slug,
                'region': droplet.region.slug,
                'ip': ipPublic,
                'dashboard': ipPublic ? getDashboardUrl(ipPublic) : '',
            };
        });
    };

    async deleteAllActiveNodes() {
        const input = {
            tag_name: this.dropletTag,
        };
        await this.dots.droplet.deleteDropletsByTag(input);
        return true;
    };

    async getSshKeys() {
        const input = {
            per_page: 100,
        };
        const {data: {ssh_keys}} = await this.dots.sshKey.listSshKeys(input);
        return ssh_keys;
    };

    async createNodes(region, size, quantity) {
        const names = Array.from({length: quantity}, (_, index) => 'radix-hyperscale-'+generateRandomHex(16));

        console.log('Loading your SSH key fingerprints...');
        const availableSshKeyFingerprints = (await this.getSshKeys()).map(key => key.fingerprint); // @TODO: make this optional / fail gracefully

        const hyperscaleFilesBaseUrl = rtrimSlashes(Alpine.store('settings').hyperscaleFilesBaseUrl.trim());

        // @TODO: better error handling?
        let cloudInitContent = await fetch('cloud-init.txt').then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        });

        cloudInitContent = cloudInitContent.replaceAll('###HYPERSCALE_FILES_BASE_URL###', hyperscaleFilesBaseUrl);

        // console.log('cloud-init content:', cloudInitContent);

        const input = {
            names,
            region,
            size,
            image: "ubuntu-24-10-x64", // string
            tags: [this.dropletTag],
            ssh_keys: availableSshKeyFingerprints,
            monitoring: true,
            user_data: cloudInitContent.trim(),
            with_droplet_agent: true,
        };

        console.log('Creation config:');
        console.log(JSON.stringify({...input, user_data: input.user_data.substring(0, 13) + ' [...]'}, null, 2));

        console.log('Creating droplets...');
        const {data: {droplets}} = await this.dots.droplet.createDroplets(input);

        console.log(JSON.stringify(droplets, null, 4));

        return droplets;
    };

    async getCosts() {
        // @TODO: support currencies
        const currencyFormatter = getCurrencyFormatter();

        console.log('Loading list of droplets...');

        const droplets = await this.getActiveNodes();

        const priceHourly = droplets.reduce((sum, droplet) => {
            return sum + droplet.price_hourly;
        }, 0);
        const priceMonthly = droplets.reduce((sum, droplet) => {
            return sum + droplet.price_monthly;
        }, 0);

        return {
            forTag: this.dropletTag,
            dropletCount: droplets.length,
            priceHourly: priceHourly,
            priceHourlyFormatted: currencyFormatter.format(priceHourly),
            priceMonthly: priceMonthly,
            priceMonthlyFormatted: currencyFormatter.format(priceMonthly),
        };
    };
}


const hyperscaleFilesBaseUrlDefault = 'https://projektvorschau.net/hyperscale/';
const nodeStatsProxyHostDefault = 'radix-hyperscale-node-stats-proxy.projektvorschau.net';

Alpine.store('settings', {
    apiKey: Alpine.$persist(null).as('settings_apiKey'),
    platform: Alpine.$persist('DigitalOcean').as('settings_platform'),
    api: null,
    apiState: 'unknown',
    hyperscaleFilesBaseUrl: Alpine.$persist(hyperscaleFilesBaseUrlDefault).as('settings_hyperscaleFilesBaseUrl'), // @TODO: validate URL format
    hyperscaleFilesBaseUrlDefault: hyperscaleFilesBaseUrlDefault,
    nodeStatsProxyHost: Alpine.$persist(nodeStatsProxyHostDefault).as('settings_nodeStatsProxyHost'), // @TODO: validate host format
    nodeStatsProxyHostDefault: nodeStatsProxyHostDefault,
    get nodeStatsProxyHostSanitized() {
        return this.nodeStatsProxyHost.replace(/^https?:\/\//i, '');
    },
    triggerActiveNodesRefreshCount: 1, // keep at 1 minimum (truthy value)
    triggerActiveNodesRefresh() {
        ++this.triggerActiveNodesRefreshCount;
    },
    triggerNodeStatsRefreshCount: 1, // keep at 1 minimum (truthy value)
    triggerNodeStatsRefresh() {
        ++this.triggerNodeStatsRefreshCount;
    },
});


Alpine.effect(async () => {
    const apiKey = Alpine.store('settings').apiKey + ''; // turn into scalar string

    if (apiKey.trim() === '') {
        Alpine.store('settings').apiState = ApiState.Unknown;
        Alpine.store('settings').api = null;
        return;
    }

    Alpine.store('settings').apiState = ApiState.Evaluating;

    const api = new DigitalOceanPlatform(apiKey);

    let apiAccessCheck = false;
    try {
        apiAccessCheck = await api.checkAccess();
    }
    catch (e) {
        console.error('API access check failed');
    }

    Alpine.store('settings').apiState = apiAccessCheck ? ApiState.Ok : ApiState.Unauthenticated;
    Alpine.store('settings').api = api;
});


Alpine.data('apiKeyInput', () => ({
    visible: false,
    maskTimeout: null,
    maskDelay: 2000,
    scopeInfoVisible: false,

    init() {
        if ((Alpine.store('settings').apiKey ?? '').trim() === '') {
            this.visible = true;
        }
    },

    toggleVisibility() {
        this.visible = !this.visible;
        clearTimeout(this.maskTimeout);
    },

    resetInvisibilityTimer() {
        console.log('resetInvisibilityTimer called');
        clearTimeout(this.maskTimeout);
        this.maskTimeout = setTimeout(() => {
            console.log('resetInvisibilityTimer timeout callback executed');
            this.visible = false;
        }, this.maskDelay);
    },

    onInputChange() {
        // Your arbitrary code here. For example:
        console.log("Key changed:", Alpine.store('settings').apiKey);
        if ((Alpine.store('settings').apiKey ?? '').trim() !== '') {
            this.resetInvisibilityTimer();
        }
    }
}));

Alpine.data('createNodes', () => ({
    quantity: 1,
    region: '',
    size: '',
    loading: false,

    init() {
        this.resetForm();
    },

    resetForm() {
        this.quantity = 1;
        this.region = 'ams';
        this.size = 's-4vcpu-16gb-amd';
    },

    async handleSubmit() {
        return await this.create();
    },

    async create() {
        if (!Alpine.store('settings').apiState.equals(ApiState.Ok)) {
            return;
        }

        if (this.loading) {
            return;
        }

        try {
            this.loading = true;
            const result = await Alpine.store('settings').api.createNodes(this.region, this.size, this.quantity);

            await sleep(2000); // wait some time so the new droplets will probably be included in the next droplet list refresh

            Alpine.store('settings').triggerActiveNodesRefresh();
        }
        catch (e) {
            alert('An error occurred while creating nodes: ' + e.message);
        }
        finally {
            this.loading = false;
        }
    },
}));

Alpine.data('activeNodes', () => ({
    list: [],
    get empty() {
        return this.list.length < 1;
    },
    loading: false,
    error: false,

    init() {
        Alpine.effect(() => {
            if (Alpine.store('settings').apiState.equals(ApiState.Ok) && Alpine.store('settings').triggerActiveNodesRefreshCount) {
                this.load();
            }
        });
    },

    async load() {
        console.warn('activeNodes.load() called');

        if (!Alpine.store('settings').apiState.equals(ApiState.Ok)) {
            return;
        }

        /*
        if (this.loading) {
            console.warn('activeNodes.load() already loading, exiting');
            return;
        }
        */

        try {
            this.loading = true;
            console.warn('activeNodes.load() set loading = true');
            this.list = [...await Alpine.store('settings').api.getActiveNodes()];
            this.error = false;

            Alpine.store('settings').triggerNodeStatsRefresh();
        }
        catch (e) {
            this.error = true;
        }
        finally {
            this.loading = false;
            console.warn('activeNodes.load() set loading = false');
        }
    },
}));

Alpine.data('deleteAllNodes', () => ({
    loading: false,

    init() {

    },

    async deleteAll() {
        if (!Alpine.store('settings').apiState.equals(ApiState.Ok)) {
            return;
        }

        if (this.loading) {
            return;
        }

        try {
            this.loading = true;
            await Alpine.store('settings').api.deleteAllActiveNodes();

            await sleep(2000); // wait some time for the droplet list refresh

            Alpine.store('settings').triggerActiveNodesRefresh();
        }
        catch (e) {
            alert('An error occurred while deleting all nodes. Please check your DigitalOcean account and remove leftover droplets manually! Error message: ' + e.message);
        }
        finally {
            this.loading = false;
        }
    },
}));

Alpine.data('currentCosts', () => ({
    loading: false,
    error: false,
    costs: null,

    init() {
        Alpine.effect(() => {
            if (Alpine.store('settings').apiState.equals(ApiState.Ok) && Alpine.store('settings').triggerActiveNodesRefreshCount) {
                this.load();
            }
        });
    },

    async load() {
        console.warn('currentCosts.load() called');

        if (!Alpine.store('settings').apiState.equals(ApiState.Ok)) {
            return;
        }

        /*
        if (this.loading) {
            console.warn('activeNodes.load() already loading, exiting');
            return;
        }
        */

        try {
            this.loading = true;
            console.warn('currentCosts.load() set loading = true');
            this.costs = await Alpine.store('settings').api.getCosts();

            this.error = false;
        }
        catch (e) {
            this.error = true;
        }
        finally {
            this.loading = false;
            console.warn('currentCosts.load() set loading = false');
        }
    },
}));

Alpine.data('nodeStats', (node) => ({
    loading: false,
    error: false,
    accessible: false,
    node: {
        synced: false,
        head: {
            height: -1,
            timestamp: -1,
        },
        shardGroup: -1,
    },
    network: {
        connections: -1,
    },
    ledger: {
        finality: {
            consensus:  -1,
            client: -1,
        },
    },

    init() {
        // this.load();

        Alpine.effect(() => {
            if (Alpine.store('settings').triggerNodeStatsRefreshCount) {
                this.load();
            }
        });
    },

    async load() {
        console.warn('currentCosts.load() called');

        if (typeof node?.ip === 'undefined' || (node.ip + '').trim() === '') {
            this.accessible = false;
            console.error('nodeStats.load(): Can not load node stats as given ip node is empty');
            return;
        }

        /*
        if (this.loading) {
            console.warn('activeNodes.load() already loading, exiting');
            return;
        }
        */

        try {
            this.loading = true;

            console.warn('nodeStats.load() [' + node.ip + ']: set loading = true');

            this.node = {...await loadNodeStats(node.ip)};
            this.network = {...(await loadNetworkStats(node.ip)).network};
            this.ledger = {...(await loadLedgerStats(node.ip)).ledger};

            this.accessible = true;
            this.error = false;
        }
        catch (e) {
            this.accessible = false;
            this.error = true;
        }
        finally {
            this.loading = false;
            console.warn('nodeStats.load() [' + node.ip + ']: set loading = false');
        }
    },
}));

async function loadNodeStats(ip) {
    const url = getApiUrl(ip, '/node');

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const jsonResponse = await response.json();

    return {
        synced: jsonResponse?.node?.synced,
        head: {
            height: jsonResponse?.node?.head?.height,
            timestamp: jsonResponse?.node?.head?.timestamp,
        },
        shardGroup: jsonResponse?.node?.shard_group,
    };
}

async function loadNetworkStats(ip) {
    const url = getApiUrl(ip, '/network/statistics');

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const jsonResponse = await response.json();

    return {
        network: {
            connections: jsonResponse?.statistics?.connections,
        },
    };
}

async function loadLedgerStats(ip) {
    const url = getApiUrl(ip, '/ledger/statistics');

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const jsonResponse = await response.json();

    return {
        ledger: {
            finality: {
                consensus: jsonResponse?.statistics?.throughput?.finality?.consensus,
                client: jsonResponse?.statistics?.throughput?.finality?.client,
            },
        },
    };
}

function getDashboardUrl(ip) {
    return 'http://' + ip + ':8080/dashboard/index.html';
}

function getApiUrl(ip, relativePath) {
    return 'https://' + Alpine.store('settings').nodeStatsProxyHostSanitized + '/api' + relativePath + (relativePath.includes('?') ? '&' : '?') + 'target=' + ip;
}

function generateRandomHex(length) {
    const byteLength = Math.ceil(length / 2);
    const randomBytes = new Uint8Array(byteLength);
    crypto.getRandomValues(randomBytes);

    let hex = '';
    for (let i = 0; i < randomBytes.length; i++) {
        hex += randomBytes[i].toString(16).padStart(2, '0');
    }

    return hex.slice(0, length); // ensures exact length
}

function rtrimSlashes(str) {
    return str.replace(/\/+$/, '');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCurrencyFormatter() {
    return new Intl.NumberFormat('de-DE', {style: 'currency', currency: 'EUR'});
}
