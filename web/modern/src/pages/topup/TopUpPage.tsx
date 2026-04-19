import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { ResponsivePageContainer } from '@/components/ui/responsive-container';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import * as z from 'zod';

const QUOTA_PER_UNIT_FALLBACK = 500000;

function readQuotaPerUnit(): number {
  const raw = parseFloat(localStorage.getItem('quota_per_unit') || `${QUOTA_PER_UNIT_FALLBACK}`);
  return Number.isFinite(raw) && raw > 0 ? raw : QUOTA_PER_UNIT_FALLBACK;
}

function formatBalance(quota: number): { dollars: string; cents: string } {
  const usd = quota / readQuotaPerUnit();
  const fixed = usd.toFixed(2);
  const [d, c] = fixed.split('.');
  const withGrouping = Number(d).toLocaleString('en-US');
  return { dollars: withGrouping, cents: c };
}

export function TopUpPage() {
  const { user, updateUser } = useAuthStore();
  const location = useLocation();
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, defaultValue: string, options?: Record<string, unknown>) =>
      t(`topup.${key}`, { defaultValue, ...options }),
    [t]
  );

  const [userQuota, setUserQuota] = useState(user?.quota ?? 0);
  const [userData, setUserData] = useState<any>(null);
  const [topUpLink, setTopUpLink] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const stripeOutcome = useMemo<'success' | 'cancel' | null>(() => {
    if (location.pathname.endsWith('/topup/success')) return 'success';
    if (location.pathname.endsWith('/topup/cancel')) return 'cancel';
    return null;
  }, [location.pathname]);

  // ─── Forms ────────────────────────────────────────────────────────
  const minTopUpUSD = 20;
  const stripeSchema = z.object({
    amount_usd: z.coerce
      .number({ invalid_type_error: tr('stripe.required', 'Enter an amount in USD') })
      .min(minTopUpUSD, tr('stripe.min', `Minimum is $${minTopUpUSD}`, { value: minTopUpUSD }))
      .max(100000, tr('stripe.max', 'Amount too large')),
  });
  type StripeForm = z.infer<typeof stripeSchema>;
  const stripeForm = useForm<StripeForm>({
    resolver: zodResolver(stripeSchema),
    defaultValues: { amount_usd: minTopUpUSD },
  });
  const [isStripeSubmitting, setIsStripeSubmitting] = useState(false);

  const codeSchema = z.object({
    redemption_code: z.string().min(1, tr('redeem.required', 'Redemption code is required')),
  });
  type CodeForm = z.infer<typeof codeSchema>;
  const codeForm = useForm<CodeForm>({
    resolver: zodResolver(codeSchema),
    defaultValues: { redemption_code: '' },
  });
  const [isCodeSubmitting, setIsCodeSubmitting] = useState(false);

  // ─── Data ──────────────────────────────────────────────────────────
  const loadUserData = async () => {
    setIsRefreshing(true);
    try {
      const res = await api.get('/api/user/self');
      const { success, data } = res.data;
      if (success) {
        setUserQuota(data.quota);
        setUserData(data);
        updateUser(data);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadSystemStatus = () => {
    const status = localStorage.getItem('status');
    if (!status) return;
    try {
      const parsed = JSON.parse(status);
      if (parsed.top_up_link) setTopUpLink(parsed.top_up_link);
    } catch (error) {
      console.error('Error parsing system status:', error);
    }
  };

  useEffect(() => {
    loadUserData();
    loadSystemStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────
  const onStripeSubmit = async (data: StripeForm) => {
    setIsStripeSubmitting(true);
    try {
      const res = await api.post('/api/user/topup/stripe', { amount_usd: data.amount_usd });
      const { success, message, data: payload } = res.data;
      if (success && payload?.url) {
        window.location.href = payload.url;
        return;
      }
      stripeForm.setError('root', {
        message: message || tr('stripe.failed', 'Failed to create checkout session'),
      });
    } catch (error) {
      stripeForm.setError('root', {
        message: error instanceof Error ? error.message : tr('stripe.failed', 'Failed to create checkout session'),
      });
    } finally {
      setIsStripeSubmitting(false);
    }
  };

  const onCodeSubmit = async (data: CodeForm) => {
    setIsCodeSubmitting(true);
    try {
      const res = await api.post('/api/user/topup', { key: data.redemption_code });
      const { success, message, data: added } = res.data;
      if (success) {
        codeForm.reset();
        codeForm.setError('root', {
          type: 'success',
          message: tr('redeem.success', `Successfully redeemed! Added {{value}} tokens.`, {
            value: (added || 0).toLocaleString(),
          }),
        });
        loadUserData();
      } else {
        codeForm.setError('root', { message: message || tr('redeem.failed', 'Redemption failed') });
      }
    } catch (error) {
      codeForm.setError('root', {
        message: error instanceof Error ? error.message : tr('redeem.failed', 'Redemption failed'),
      });
    } finally {
      setIsCodeSubmitting(false);
    }
  };

  const openTopUpLink = () => {
    if (!topUpLink) return;
    try {
      const url = new URL(topUpLink);
      if (userData) {
        url.searchParams.append('username', userData.username);
        url.searchParams.append('user_id', userData.id.toString());
        const uuid =
          (globalThis as any).crypto?.randomUUID?.() ??
          'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
        url.searchParams.append('transaction_id', uuid);
      }
      window.open(url.toString(), '_blank');
    } catch (error) {
      console.error('Error opening top-up link:', error);
    }
  };

  // ─── Derived ───────────────────────────────────────────────────────
  const balance = formatBalance(userQuota);
  const accountNo = (userData?.id ?? user?.id ?? 0).toString().padStart(4, '0');
  const todayLabel = useMemo(() => {
    const d = new Date();
    return d
      .toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
      .toUpperCase();
  }, []);
  const tokensLabel = `${userQuota.toLocaleString()} ${tr('tokens', 'tokens')}`;
  const tipsList = (t('topup.tips.content', { returnObjects: true }) as unknown as string[]) || [];

  return (
    <ResponsivePageContainer className="max-w-5xl">
      <div className="ledger space-y-10 pb-8">
        {/* ── Eyebrow heading ───────────────────────────────────────── */}
        <header className="ledger-rise flex items-end justify-between gap-6">
          <div>
            <p className="ledger-eyebrow mb-3">{tr('hero.eyebrow', 'Apothecary · Ledger')}</p>
            <h1 className="ledger-number text-4xl md:text-5xl text-foreground">
              {tr('hero.title', 'Refill')}
            </h1>
          </div>
          <p className="ledger-mono hidden md:block text-xs text-muted-foreground">{todayLabel}</p>
        </header>

        {/* ── Outcome banners ───────────────────────────────────────── */}
        {stripeOutcome === 'success' && (
          <div className="ledger-rise ledger-delay-1 border-l-2 border-success pl-4 py-2 text-sm">
            <span className="ledger-eyebrow text-success block mb-1">
              {tr('stripe.outcome_success_eyebrow', 'Receipt filed')}
            </span>
            <span className="text-foreground">
              {tr(
                'stripe.outcome_success',
                'Payment received. Your balance will update within a moment once Stripe confirms the charge.'
              )}
            </span>
          </div>
        )}
        {stripeOutcome === 'cancel' && (
          <div className="ledger-rise ledger-delay-1 border-l-2 border-warning pl-4 py-2 text-sm">
            <span className="ledger-eyebrow text-warning block mb-1">
              {tr('stripe.outcome_cancel_eyebrow', 'Filed away')}
            </span>
            <span className="text-foreground">
              {tr('stripe.outcome_cancel', 'Payment was canceled. You have not been charged.')}
            </span>
          </div>
        )}

        {/* ── Hero balance card ─────────────────────────────────────── */}
        <section className="ledger-rise ledger-delay-2 ledger-card ledger-paper p-6 md:p-10 overflow-hidden relative">
          {/* Botanical sprig */}
          <svg
            className="ledger-sprig absolute -top-2 right-6 h-24 w-24 text-primary/25 hidden md:block"
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M50 95 C50 70, 50 45, 50 12" />
            <path d="M50 78 C40 74, 32 68, 30 58 C38 60, 46 66, 50 74" fill="currentColor" fillOpacity="0.15" />
            <path d="M50 64 C60 60, 68 54, 70 44 C62 46, 54 52, 50 60" fill="currentColor" fillOpacity="0.15" />
            <path d="M50 50 C40 46, 32 40, 30 30 C38 32, 46 38, 50 46" fill="currentColor" fillOpacity="0.15" />
            <path d="M50 36 C60 32, 68 26, 70 16 C62 18, 54 24, 50 32" fill="currentColor" fillOpacity="0.15" />
            <circle cx="50" cy="10" r="2" fill="currentColor" />
          </svg>

          <div className="flex items-baseline justify-between gap-4 mb-4">
            <p className="ledger-eyebrow">
              {tr('balance.eyebrow', 'Account')} · N° {accountNo}
            </p>
            <button
              type="button"
              onClick={loadUserData}
              disabled={isRefreshing}
              className="ledger-eyebrow inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              {tr('balance.refresh', 'Refresh')}
            </button>
          </div>

          <hr className="ledger-rule mb-8" />

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="ledger-ink">
              <div className="flex items-start gap-2">
                <span className="ledger-number text-3xl md:text-4xl text-muted-foreground pt-3">$</span>
                <span className="ledger-number text-7xl md:text-9xl text-foreground">{balance.dollars}</span>
                <span className="ledger-number text-3xl md:text-4xl text-muted-foreground pt-3">
                  .{balance.cents}
                </span>
              </div>
              <p className="ledger-mono mt-4 text-xs text-muted-foreground">
                {tokensLabel} · {tr('balance.unit', 'available for relay calls')}
              </p>
            </div>
          </div>
        </section>

        {/* ── Refill grid: Stripe (primary, wide) + Code (slim) ─────── */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Stripe — primary */}
          <div className="ledger-rise ledger-delay-3 lg:col-span-3 ledger-card p-6 md:p-8 relative">
            <div className="flex items-baseline justify-between mb-1">
              <p className="ledger-eyebrow">{tr('stripe.section', 'Refill · Card')}</p>
              <p className="ledger-eyebrow">USD</p>
            </div>
            <h2 className="ledger-number text-2xl text-foreground mb-1">
              {tr('stripe.title', 'Pay with Card')}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {tr(
                'stripe.description',
                'Top up your balance using a credit or debit card. USD only, $20 minimum.'
              )}
            </p>

            <hr className="ledger-rule-double mb-6" />

            <Form {...stripeForm}>
              <form onSubmit={stripeForm.handleSubmit(onStripeSubmit)} className="space-y-6">
                <FormField
                  control={stripeForm.control}
                  name="amount_usd"
                  render={({ field }) => (
                    <FormItem>
                      <p className="ledger-eyebrow mb-3">{tr('stripe.label', 'Amount')}</p>
                      <FormControl>
                        <div className="flex items-baseline gap-3 border-b border-border pb-3 focus-within:border-primary transition-colors">
                          <span className="ledger-number text-3xl md:text-4xl text-muted-foreground">$</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={minTopUpUSD}
                            step="1"
                            placeholder={String(minTopUpUSD)}
                            className="ledger-amount-input text-4xl md:text-5xl"
                            {...field}
                          />
                          <span className="ledger-mono text-xs text-muted-foreground pb-2">
                            {tr('stripe.min_label', `min $${minTopUpUSD}`, { value: minTopUpUSD })}
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage className="ledger-mono text-xs mt-3" />
                    </FormItem>
                  )}
                />

                {stripeForm.formState.errors.root && (
                  <div className="ledger-mono text-xs text-destructive">
                    {stripeForm.formState.errors.root.message}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
                  <p className="ledger-mono text-[11px] leading-relaxed text-muted-foreground max-w-xs">
                    {tr(
                      'stripe.note',
                      'You will be redirected to Stripe Checkout. Your balance will update once payment is confirmed.'
                    )}
                  </p>
                  <button type="submit" disabled={isStripeSubmitting} className="ledger-stamp self-start sm:self-auto">
                    {isStripeSubmitting
                      ? tr('stripe.processing', 'Redirecting…')
                      : tr('stripe.button', 'Continue to Stripe →')}
                  </button>
                </div>
              </form>
            </Form>
          </div>

          {/* Redemption code — slim */}
          <div className="ledger-rise ledger-delay-4 lg:col-span-2 ledger-card p-6 md:p-8 flex flex-col">
            <div className="flex items-baseline justify-between mb-1">
              <p className="ledger-eyebrow">{tr('redeem.section', 'Refill · Code')}</p>
              <p className="ledger-eyebrow text-muted-foreground/60">N°02</p>
            </div>
            <h2 className="ledger-number text-2xl text-foreground mb-1">
              {tr('redeem.title', 'Redeem Code')}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {tr('redeem.description', 'Enter a redemption code to add quota')}
            </p>

            <hr className="ledger-rule mb-6" />

            <Form {...codeForm}>
              <form onSubmit={codeForm.handleSubmit(onCodeSubmit)} className="space-y-5 flex-1 flex flex-col">
                <FormField
                  control={codeForm.control}
                  name="redemption_code"
                  render={({ field }) => (
                    <FormItem>
                      <p className="ledger-eyebrow mb-2">{tr('redeem.label', 'Redemption Code')}</p>
                      <FormControl>
                        <input
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={tr('redeem.placeholder', 'Enter your redemption code')}
                          className="ledger-input w-full text-base text-foreground placeholder:text-muted-foreground/60"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="ledger-mono text-xs mt-2" />
                    </FormItem>
                  )}
                />

                {codeForm.formState.errors.root && (
                  <div
                    className={`ledger-mono text-xs ${
                      codeForm.formState.errors.root.type === 'success' ? 'text-success' : 'text-destructive'
                    }`}
                  >
                    {codeForm.formState.errors.root.message}
                  </div>
                )}

                <div className="mt-auto pt-4">
                  <Button type="submit" variant="outline" className="w-full" disabled={isCodeSubmitting}>
                    {isCodeSubmitting
                      ? tr('redeem.processing', 'Redeeming...')
                      : tr('redeem.button', 'Redeem Code')}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </section>

        {/* ── External top-up & Tips footer ─────────────────────────── */}
        <section className="ledger-rise ledger-delay-5 grid grid-cols-1 md:grid-cols-12 gap-8 pt-4">
          {topUpLink && (
            <div className="md:col-span-5">
              <p className="ledger-eyebrow mb-3">{tr('online.eyebrow', 'Elsewhere')}</p>
              <hr className="ledger-rule mb-4" />
              <h3 className="ledger-number text-xl text-foreground mb-2">
                {tr('online.title', 'Online Payment')}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {tr(
                  'online.description',
                  'Purchase quota through our external payment system'
                )}
              </p>
              <button
                type="button"
                onClick={openTopUpLink}
                className="ledger-mono text-xs inline-flex items-center gap-1.5 text-foreground hover:text-primary transition-colors group"
              >
                <span className="border-b border-current pb-0.5">
                  {tr('online.button', 'Open Payment Portal')}
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
          )}

          <div className={topUpLink ? 'md:col-span-7' : 'md:col-span-12'}>
            <p className="ledger-eyebrow mb-3">{tr('tips.eyebrow', 'Marginalia')}</p>
            <hr className="ledger-rule mb-4" />
            <ol className="space-y-3 ledger-mono text-xs text-muted-foreground leading-relaxed">
              {tipsList.map((tip, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-primary/70 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-sans text-sm text-foreground/80">{tip}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </ResponsivePageContainer>
  );
}

export default TopUpPage;
