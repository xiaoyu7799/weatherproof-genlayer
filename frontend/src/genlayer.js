import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

export const CHAIN_ID = 61999
export const CHAIN_ID_HEX = '0xf22f'
export const RPC_URL = 'https://studio.genlayer.com/api'
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || ''
export const EXPLORER = 'https://explorer-studio.genlayer.com'

export function explorerAddress(addr) { return `${EXPLORER}/address/${addr}` }
export function explorerTx(hash) { return `${EXPLORER}/tx/${hash}` }

export function readClient() {
  return createClient({ chain: studionet })
}

export function writeClient(accountAddress) {
  return createClient({ chain: studionet, account: accountAddress })
}

// Wallet-agnostic fallback for wallets that cannot install the GenLayer
// Snap (OKX, Rabby, mobile wallets, etc.): generate an ephemeral account
// in the browser and sign with it. Studionet is gasless and permissionless,
// so this produces a REAL on-chain transaction — but the requester on-chain
// will be this ephemeral address, NOT the reviewer's wallet address, and
// the key lives only in browser memory and is discarded on refresh. Callers
// must show that honestly; never present it as a wallet-signed transaction.
export function reviewerClient() {
  const account = createAccount(generatePrivateKey())
  return { address: account.address, client: createClient({ chain: studionet, account }) }
}

// Connect any injected EVM wallet (MetaMask, OKX, Rabby, Coinbase, …) for
// address + chain only, without requiring the Snap. Returns the wallet
// address; callers then try the Snap separately.
export async function connectWalletAddress() {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet found. Install a wallet extension (MetaMask, OKX, Rabby, …), then try again.')
  const accounts = await eth.request({ method: 'eth_requestAccounts' })
  const address = accounts[0]
  if (!address) throw new Error('No account selected in the wallet.')
  await ensureStudionet()
  return address
}

export async function ensureStudionet() {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet found. Install MetaMask, then try again.')
  const current = await eth.request({ method: 'eth_chainId' })
  if (current !== CHAIN_ID_HEX) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] })
    } catch (err) {
      if (err && err.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: CHAIN_ID_HEX, chainName: 'GenLayer Studio Network', rpcUrls: [RPC_URL], nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 }, blockExplorerUrls: [EXPLORER] }],
        })
      } else throw err
    }
  }
}

// GenLayer writes are signed through the official GenLayer MetaMask Snap.
// This is the documented Studionet path in genlayer-js 1.1.8. If the Snap
// cannot be installed in this browser, writes cannot be signed here —
// reading existing attestations still works, and the error is shown
// instead of silently falling back to a fake result.
export async function connectWallet() {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet found. Install MetaMask, then try again.')
  const accounts = await eth.request({ method: 'eth_requestAccounts' })
  const address = accounts[0]
  if (!address) throw new Error('No account selected in the wallet.')
  await ensureStudionet()
  const client = writeClient(address)
  try {
    await client.connect('studionet')
  } catch (err) {
    const msg = err?.message || String(err)
    // wallet_getSnaps (-32601 / method not found) means this wallet is not
    // a Snaps-capable MetaMask: e.g. a mobile wallet, another extension that
    // took over window.ethereum, or an outdated MetaMask. Say so plainly
    // instead of surfacing the raw method name.
    if (/wallet_getSnaps|wallet_requestSnaps|32601|method not found/i.test(msg)) {
      throw new Error('This wallet does not support MetaMask Snaps (wallet_getSnaps not found). GenLayer writes need desktop MetaMask with Snaps enabled: switch to desktop Chrome/Edge with the latest MetaMask extension, make sure no other wallet extension is taking over, refresh, and try again. Reading attestations below still works without a wallet.')
    }
    throw new Error('GenLayer Snap could not be installed in this wallet (' + msg + '). Writes need the Snap; reading attestations below still works.')
  }
  return { address, client }
}

export async function waitFinal(client, hash, onProgress) {
  onProgress && onProgress('submitted')
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 180,
    interval: 5000,
  })
  onProgress && onProgress('finalized')
  return receipt
}

export function parseRecord(raw) {
  if (typeof raw === 'string') return JSON.parse(raw)
  return raw
}

export function verdictLabel(v) {
  return { dry: 'Dry', light_rain: 'Light rain', rain: 'Rain', heavy_rain: 'Heavy rain', thunderstorm: 'Thunderstorm', snow: 'Snow' }[v] || v || '—'
}

export function sourceUrlFor(lat, lon, date) {
  return `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max&timezone=GMT`
}

export function classify(precip, code) {
  if ([95, 96, 99].includes(code)) return 'thunderstorm'
  if (precip >= 10) return 'heavy_rain'
  if (precip >= 2.5) return 'rain'
  if (precip >= 0.1) return 'light_rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  return 'dry'
}

export const CITIES = [
  { name: 'London', lat: '51.5074', lon: '-0.1278' },
  { name: 'Shanghai', lat: '31.2304', lon: '121.4737' },
  { name: 'Berlin', lat: '52.5200', lon: '13.4050' },
  { name: 'Paris', lat: '48.8566', lon: '2.3522' },
  { name: 'New York', lat: '40.7128', lon: '-74.0060' },
  { name: 'Tokyo', lat: '35.6762', lon: '139.6503' },
  { name: 'Singapore', lat: '1.3521', lon: '103.8198' },
  { name: 'Sydney', lat: '-33.8688', lon: '151.2093' },
]

export const PURPOSES = ['Outdoor event', 'Photo shoot', 'Farm work', 'Delivery / site visit', 'Sports fixture', 'Other']
