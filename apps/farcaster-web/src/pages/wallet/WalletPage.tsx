import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { BorderedMainContent } from '~/components/BorderedMainContent';
import { WalletIcon } from '~/components/icons/WalletIcon';
import { Page } from '~/components/page/Page';
import { PageHeader } from '~/components/page/PageHeader';
import { PageTitle } from '~/components/page/PageTitle';
import { SettingsPageContent } from '~/components/page/SettingsPageContent';

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type WindowWithEthereum = Window & { ethereum?: Eip1193Provider };

const BASE_CHAIN_ID = '0x2105';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

const shortenAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const formatUnits = (value: bigint, decimals: number, maxFraction = 5) => {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base)
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxFraction)
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

const parseUnits = (value: string, decimals: number) => {
  if (!new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`).test(value)) {
    throw new Error('Enter a valid amount');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
};

const WalletPage = memo(() => {
  const [address, setAddress] = useState('');
  const [ethBalance, setEthBalance] = useState('');
  const [usdcBalance, setUsdcBalance] = useState('');
  const [chainId, setChainId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'ETH' | 'USDC'>('ETH');
  const [status, setStatus] = useState('Connect an injected EVM wallet to begin.');
  const [busy, setBusy] = useState(false);

  const provider = useMemo(
    () => (typeof window === 'undefined' ? undefined : (window as WindowWithEthereum).ethereum),
    [],
  );

  const refresh = useCallback(
    async (nextAddress?: string) => {
      if (!provider) return;
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      const account = nextAddress ?? accounts[0] ?? '';
      setAddress(account);

      const nextChainId = (await provider.request({ method: 'eth_chainId' })) as string;
      setChainId(nextChainId);

      if (!account) {
        setEthBalance('');
        setUsdcBalance('');
        return;
      }

      const nativeBalance = (await provider.request({
        method: 'eth_getBalance',
        params: [account, 'latest'],
      })) as string;
      setEthBalance(formatUnits(BigInt(nativeBalance), 18));

      if (nextChainId === BASE_CHAIN_ID) {
        const balanceOfData = `0x70a08231${account.slice(2).padStart(64, '0')}`;
        const tokenBalance = (await provider.request({
          method: 'eth_call',
          params: [{ to: BASE_USDC, data: balanceOfData }, 'latest'],
        })) as string;
        setUsdcBalance(formatUnits(BigInt(tokenBalance), USDC_DECIMALS, 2));
      } else {
        setUsdcBalance('—');
      }
    },
    [provider],
  );

  useEffect(() => {
    if (!provider?.on) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      void refresh(accounts[0] ?? '');
    };
    const handleChainChanged = () => void refresh();

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);
    void refresh();

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [provider, refresh]);

  const connect = async () => {
    if (!provider) {
      setStatus('No injected wallet found. Open Farcaster with an EIP-1193 compatible wallet.');
      return;
    }

    setBusy(true);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      await refresh(accounts[0]);
      setStatus('Wallet connected. Keys stay inside your wallet provider.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Wallet connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const switchToBase = async () => {
    if (!provider) return;
    setBusy(true);
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID }] });
      await refresh();
      setStatus('Switched to Base.');
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: BASE_CHAIN_ID,
              chainName: 'Base',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
            },
          ],
        });
        await refresh();
        setStatus('Base added and selected.');
      } else {
        setStatus(error instanceof Error ? error.message : 'Unable to switch network.');
      }
    } finally {
      setBusy(false);
    }
  };

  const sendAsset = async () => {
    if (!provider || !address) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setStatus('Enter a valid EVM recipient address.');
      return;
    }

    setBusy(true);
    try {
      let txHash: string;
      if (asset === 'ETH') {
        const value = parseUnits(amount, 18);
        txHash = (await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: address, to: recipient, value: `0x${value.toString(16)}` }],
        })) as string;
      } else {
        if (chainId !== BASE_CHAIN_ID) throw new Error('Switch to Base before sending USDC.');
        const value = parseUnits(amount, USDC_DECIMALS);
        const data = `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${value
          .toString(16)
          .padStart(64, '0')}`;
        txHash = (await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: address, to: BASE_USDC, data }],
        })) as string;
      }
      setStatus(`Transaction submitted: ${txHash}`);
      setAmount('');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Transaction failed.');
    } finally {
      setBusy(false);
    }
  };

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setStatus('Address copied.');
  };

  const openTrade = (mode: 'buy' | 'sell') => {
    const eth = 'ETH';
    const inputCurrency = mode === 'buy' ? BASE_USDC : eth;
    const outputCurrency = mode === 'buy' ? eth : BASE_USDC;
    window.open(
      `https://app.uniswap.org/swap?chain=base&inputCurrency=${inputCurrency}&outputCurrency=${outputCurrency}`,
      '_blank',
      'noopener,noreferrer',
    );
    setStatus(`${mode === 'buy' ? 'Buy' : 'Sell'} flow opened on Base.`);
  };

  const openActivity = () => {
    if (!address) return;
    window.open(`https://basescan.org/address/${address}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <Page meta={{ title: 'Wallet / Farcaster' }}>
      <div className="border-default sm:border-x">
        <PageHeader hideCastButton>
          <div className="flex items-center">
            <PageTitle>Wallet</PageTitle>
          </div>
        </PageHeader>
      </div>
      <BorderedMainContent className="flex flex-row p-6">
        <SettingsPageContent>
          <div className="flex w-full flex-col gap-4 rounded-2xl bg-elevated-nohover p-5">
            <div className="flex items-center gap-3">
              <WalletIcon />
              <div>
                <div className="text-lg font-semibold">Farcaster Web Wallet</div>
                <div className="text-sm text-muted">
                  View, receive, send, buy and sell on Base without giving Farcaster your keys.
                </div>
              </div>
            </div>

            {!provider && (
              <div className="rounded-xl border border-default p-4 text-sm">
                No injected EVM provider detected. Open this page with MetaMask, Rabby, Coinbase Wallet,
                or another EIP-1193 compatible wallet.
              </div>
            )}

            {!address ? (
              <button
                className="rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50"
                disabled={busy || !provider}
                onClick={() => void connect()}
                type="button"
              >
                {busy ? 'Connecting…' : 'Connect wallet'}
              </button>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-default p-4">
                    <div className="text-xs uppercase text-muted">Address</div>
                    <div className="mt-1 font-mono text-base">{shortenAddress(address)}</div>
                    <button className="mt-2 text-sm font-semibold" onClick={() => void copyAddress()} type="button">
                      Receive / copy
                    </button>
                  </div>
                  <div className="rounded-xl border border-default p-4">
                    <div className="text-xs uppercase text-muted">ETH</div>
                    <div className="mt-1 text-2xl font-semibold">{ethBalance || '0'}</div>
                    <div className="mt-1 text-xs text-muted">Native balance</div>
                  </div>
                  <div className="rounded-xl border border-default p-4">
                    <div className="text-xs uppercase text-muted">USDC</div>
                    <div className="mt-1 text-2xl font-semibold">{usdcBalance || '0'}</div>
                    <div className="mt-1 text-xs text-muted">Base USDC</div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    className="rounded-xl border border-default px-4 py-3 font-semibold"
                    onClick={() => openTrade('buy')}
                    type="button"
                  >
                    Buy ETH
                  </button>
                  <button
                    className="rounded-xl border border-default px-4 py-3 font-semibold"
                    onClick={() => openTrade('sell')}
                    type="button"
                  >
                    Sell ETH
                  </button>
                  <button
                    className="rounded-xl border border-default px-4 py-3 font-semibold"
                    onClick={openActivity}
                    type="button"
                  >
                    View activity
                  </button>
                </div>

                {chainId !== BASE_CHAIN_ID && (
                  <button
                    className="rounded-xl border border-default px-4 py-3 font-semibold disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void switchToBase()}
                    type="button"
                  >
                    Switch to Base
                  </button>
                )}

                <div className="rounded-xl border border-default p-4">
                  <div className="mb-3 font-semibold">Send</div>
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <button
                        className={`rounded-lg border px-3 py-2 text-sm font-semibold ${asset === 'ETH' ? 'border-primary' : 'border-default'}`}
                        onClick={() => setAsset('ETH')}
                        type="button"
                      >
                        ETH
                      </button>
                      <button
                        className={`rounded-lg border px-3 py-2 text-sm font-semibold ${asset === 'USDC' ? 'border-primary' : 'border-default'}`}
                        onClick={() => setAsset('USDC')}
                        type="button"
                      >
                        USDC
                      </button>
                    </div>
                    <input
                      className="rounded-xl border border-default bg-transparent px-3 py-2 font-mono"
                      onChange={(event) => setRecipient(event.target.value.trim())}
                      placeholder="0x recipient"
                      value={recipient}
                    />
                    <input
                      className="rounded-xl border border-default bg-transparent px-3 py-2"
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.target.value.trim())}
                      placeholder={asset === 'ETH' ? '0.001' : '10.00'}
                      value={amount}
                    />
                    <button
                      className="rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50"
                      disabled={busy || !amount || !recipient}
                      onClick={() => void sendAsset()}
                      type="button"
                    >
                      {busy ? 'Waiting for wallet…' : `Review ${asset} send in wallet`}
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="break-all rounded-xl bg-default px-3 py-2 text-xs">
              Chain {chainId || '—'} · {status}
            </div>
          </div>
        </SettingsPageContent>
      </BorderedMainContent>
    </Page>
  );
});

WalletPage.displayName = 'WalletPage';

export { WalletPage };
