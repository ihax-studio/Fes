document.addEventListener('DOMContentLoaded', () => {
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const devicesListEl = document.getElementById('devicesList');
    const connectedDevicesListEl = document.getElementById('connectedDevicesList');
    const sharedInput = document.getElementById('sharedInput');
    const syncBadge = document.getElementById('syncBadge');

    let peer;
    let myPeerId;
    let room;
    const connections = {}; // { peerId: conn }
    const allDevices = {}; // { peerId: {device, connected} }

    // --- Device Detection (Detailed) ---
    function detectDevice() {
        const w = window.screen.width;
        const h = window.screen.height;
        const ratio = window.devicePixelRatio || 1;
        const ua = navigator.userAgent;
        const platform = navigator.platform;

        // Use Math.max/min to handle both portrait and landscape
        const res = `${Math.max(w * ratio, h * ratio)}x${Math.min(w * ratio, h * ratio)}`;

        let deviceName = "コンピュータ";
        let icon = "💻";

        const deviceMap = {
            // Vision Pro
            "visionOS": { name: "Apple Vision Pro", icon: "🥽" },
            // iPhones
            "2796x1290": { name: "iPhone 15 Plus / 15 Pro Max / 16 Plus / 16 Pro Max", icon: "📱" },
            "2556x1179": { name: "iPhone 15 / 15 Pro / 16 / 16 Pro", icon: "📱" },
            "2778x1284": { name: "iPhone 12/13 Pro Max / 14 Plus", icon: "📱" },
            "2532x1170": { name: "iPhone 12/13/14 / 12/13 Pro", icon: "📱" },
            "2688x1242": { name: "iPhone XS Max / 11 Pro Max", icon: "📱" },
            "2436x1125": { name: "iPhone X / XS / 11 Pro", icon: "📱" },
            "1792x828": { name: "iPhone XR / 11", icon: "📱" },
            "2340x1080": { name: "iPhone 12 mini / 13 mini", icon: "📱" },
            "1334x750": { name: "iPhone SE (2/3 gen) / 8", icon: "📱" },
            // MacBooks
            "3456x2234": { name: "MacBook Pro 16\" (Apple Silicon)", icon: "💻" },
            "3072x1920": { name: "MacBook Pro 16\" (Intel)", icon: "💻" },
            "3024x1964": { name: "MacBook Pro 14\"", icon: "💻" },
            "2880x1800": { name: "MacBook Pro 15\" (2015-19)", icon: "💻" },
            "2880x1864": { name: "MacBook Air 15\"", icon: "💻" },
            "2560x1664": { name: "MacBook Air 13.6\"", icon: "💻" },
            "2560x1600": { name: "MacBook / MacBook Pro 13\"", icon: "💻" },
            "2304x1440": { name: "MacBook 12\"", icon: "💻" },
            "1440x900": { name: "MacBook Air (~2017)", icon: "💻" },
            // iMacs
            "5120x2880": { name: "iMac 27\" 5K / iMac Pro", icon: "🖥️" },
            "4480x2520": { name: "iMac 24\"", icon: "🖥️" },
            "4096x2304": { name: "iMac 21.5\" 4K", icon: "🖥️" },
            // iPads
            "2752x2064": { name: "iPad Pro 13\" (2024)", icon: "iPad" },
            "2732x2048": { name: "iPad Pro 12.9\" (2018-22)", icon: "iPad" },
            "2420x1668": { name: "iPad Pro 11\" (2024)", icon: "iPad" },
            "2388x1668": { name: "iPad Pro 11\" (2018-22)", icon: "iPad" },
            "1640x2360": { name: "iPad Air 13\" (6th gen)", icon: "iPad" },
            "2360x1640": { name: "iPad Air 10.9\" / iPad (10th gen)", icon: "iPad" },
            "2224x1668": { name: "iPad Air 10.5\" (3rd gen)", icon: "iPad" },
            "2266x1488": { name: "iPad mini (6th gen)", icon: "iPad" },
            "2048x1536": { name: "iPad mini (5th gen)", icon: "iPad" },
        };

        if (/VisionPro/.test(ua) || /VisionOS/.test(ua)) return deviceMap["visionOS"];
        if (deviceMap[res]) return deviceMap[res];

        if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) { icon = "📱"; deviceName = "スマートフォン"; } 
        else if (/Android/.test(ua)) { icon = "📱"; deviceName = "スマートフォン"; } 
        else if (/Mac/.test(platform)) { icon = "💻"; deviceName = "Mac"; } 
        else if (/Win/.test(platform)) { icon = "💻"; deviceName = "Windows PC"; } 
        else if (/Linux/.test(platform)) { icon = "🐧"; deviceName = "Linux PC"; } 
        else if (/CrOS/.test(ua)) { icon = "💻"; deviceName = "ChromeOS"; }
        
        return { name: deviceName, icon: icon };
    }
    const myDevice = detectDevice();

    // --- Get Public IP to define a "room" ---
    async function getRoomId() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            // Use a prefix and the IP to create a room name
            return `p2p-sync-${data.ip}`;
        } catch (error) {
            console.error("Could not fetch IP, using a generic room.", error);
            // Fallback to a generic room if IP fetch fails
            return "p2p-sync-public-room";
        }
    }

    // --- PeerJS Initialization ---
    async function initializePeer() {
        room = await getRoomId();
        console.log("Joining room:", room);

        // Construct a unique but identifiable peer ID
        const randomId = Math.random().toString(36).substring(2, 10);
        myPeerId = `${room}-${randomId}`;
        
        allDevices[myPeerId] = { device: myDevice, connected: true };

        // Connect to the public PeerJS server
        peer = new Peer(myPeerId, { debug: 2 });

        peer.on('open', (id) => {
            console.log('My Peer ID is:', id);
            statusText.textContent = 'ネットワークをスキャン中...';
            statusEl.className = 'status waiting';
            // Start discovering other peers
            setInterval(discoverPeers, 3000); // Scan every 3 seconds
            updateUI();
        });

        peer.on('connection', (conn) => {
            console.log('Incoming connection from', conn.peer);
            setupConnection(conn);
        });

        peer.on('error', (err) => console.error('PeerJS error:', err));
    }

    // --- Discovery ---
    function discoverPeers() {
        peer.list((allPeerIds) => {
            const nearbyPeerIds = allPeerIds.filter(id => id.startsWith(room) && id !== myPeerId);
            
            for (const peerId of nearbyPeerIds) {
                if (!allDevices[peerId]) {
                     // Found a new device, but don't know its type yet
                    allDevices[peerId] = { device: { name: "新しいデバイス", icon: "📡" }, connected: false };
                    // Attempt to connect to get device info
                    connectToPeer(peerId);
                }
            }
            updateUI();
        });
    }

    // --- WebRTC Connection Logic ---
    function connectToPeer(peerId) {
        if (connections[peerId] || peerId === myPeerId) return;
        console.log('Connecting to peer:', peerId);
        const conn = peer.connect(peerId, { reliable: true });
        setupConnection(conn);
    }

    function setupConnection(conn) {
        conn.on('open', () => {
            console.log('Connection established with', conn.peer);
            connections[conn.peer] = conn;
            allDevices[conn.peer].connected = true;

            conn.send({ type: 'device-info', device: myDevice });
            updateUI();
        });

        conn.on('data', (data) => handleData(conn.peer, data));

        conn.on('close', () => {
            console.log('Connection closed with', conn.peer);
            delete connections[conn.peer];
            if(allDevices[conn.peer]) allDevices[conn.peer].connected = false;
            updateUI();
        });
    }

    // --- Data Handling ---
    function handleData(peerId, data) {
        switch (data.type) {
            case 'device-info':
                allDevices[peerId].device = data.device;
                updateUI();
                break;
            case 'input-sync':
                sharedInput.value = data.value;
                showSyncBadge();
                break;
        }
    }

    function broadcastData(data) {
        for (const peerId in connections) {
            connections[peerId].send(data);
        }
    }

    // --- UI Updates ---
    function updateUI() {
        devicesListEl.innerHTML = '';
        connectedDevicesListEl.innerHTML = '';

        let connectedCount = 0;
        let nearbyCount = 0;

        // Add my own device to the connected list
        const myDeviceEl = createDeviceElement(myPeerId, true, true);
        connectedDevicesListEl.appendChild(myDeviceEl);
        connectedCount++;

        for (const peerId in allDevices) {
            if (peerId === myPeerId) continue;

            const isConnected = allDevices[peerId].connected;
            const el = createDeviceElement(peerId, isConnected, false);

            if (isConnected) {
                connectedDevicesListEl.appendChild(el);
                connectedCount++;
            } else {
                devicesListEl.appendChild(el);
                nearbyCount++;
            }
        }

        if (nearbyCount === 0) {
            devicesListEl.innerHTML = '<div class="empty-state"><p>📡 スキャン中...</p></div>';
        }
        if (connectedCount <= 1) {
             connectedDevicesListEl.innerHTML = '<div class="empty-state"><p>他のデバイスからの接続を待っています。</p></div>';
             // Re-add my device if the list was cleared
             connectedDevicesListEl.prepend(myDeviceEl);
        }

        // Update main status
        const totalConnected = Object.keys(connections).length;
        if (totalConnected > 0) {
            statusEl.className = 'status connected';
            statusText.textContent = `✓ ${totalConnected}台のデバイスと接続中`;
            sharedInput.disabled = false;
        } else {
            statusEl.className = 'status waiting';
            statusText.textContent = '近くのデバイスをスキャン中...';
            sharedInput.disabled = true;
        }
    }

    function createDeviceElement(peerId, isConnected, isMe) {
        const device = allDevices[peerId].device;
        const el = document.createElement('div');
        el.className = 'device-item';
        el.innerHTML = `
            <div class="device-details">
                <div class="device-name">${device.icon} ${device.name} ${isMe ? '(このデバイス)' : ''}</div>
            </div>
            ${isConnected ? '<div class="connected-badge">✓ 接続済み</div>' : ''}
        `;
        if (!isConnected) {
            el.style.cursor = 'pointer';
            el.onclick = () => connectToPeer(peerId);
        }
        return el;
    }
    
    function showSyncBadge() {
        syncBadge.classList.add('show');
        setTimeout(() => syncBadge.classList.remove('show'), 1000);
    }

    // --- Event Listeners ---
    sharedInput.addEventListener('input', (e) => {
        broadcastData({
            type: 'input-sync',
            value: e.target.value
        });
    });

    // --- Initial Kick-off ---
    initializePeer();
});