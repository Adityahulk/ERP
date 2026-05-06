import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, Plus,
  Building2, Users, LogOut, ChevronRight, CreditCard,
  Phone, Mail, AlertCircle, Rocket, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';
import { useRegistrantStore } from '@/store/registrantStore';
import { launchRegistrantCompany } from '@/lib/registrantCompanyLaunch';

interface License {
  id: string;
  license_key: string;
  status: 'pending' | 'active' | 'trial' | 'expired' | 'revoked';
  tier_name: string;
  tier_display_name: string;
  max_users: number;
  price_inr: number;
  activated_at: string | null;
  expires_at: string | null;
  requested_at: string;
  company_id: string | null;
  company_name: string | null;
  active_users: string;
}

const STATUS_CONFIG = {
  pending: {
    label: 'Payment Pending',
    icon: Clock,
    className: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
  },
  active: {
    label: 'Active',
    icon: CheckCircle2,
    className: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
  },
  trial: {
    label: 'Trial Active',
    icon: Rocket,
    className: 'bg-violet-500/10 text-violet-300 border border-violet-500/30',
  },
  expired: {
    label: 'Expired',
    icon: AlertCircle,
    className: 'bg-slate-500/10 text-slate-400 border border-slate-500/30',
  },
  revoked: {
    label: 'Revoked',
    icon: XCircle,
    className: 'bg-red-500/10 text-red-400 border border-red-500/30',
  },
};

const TIER_COLORS = {
  silver: 'from-slate-400 to-slate-300',
  gold: 'from-yellow-500 to-amber-400',
  diamond: 'from-cyan-400 to-blue-500',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function RegisterDashboard() {
  const navigate = useNavigate();
  const { registrant, logout, isAuthenticated, updateRegistrant } = useRegistrantStore();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingLicenseId, setLaunchingLicenseId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/register/login');
      return;
    }
    fetchData();
  }, [isAuthenticated]);

  const fetchData = async () => {
    try {
      setLoadError(null);
      const { data: res } = await registrantApi.get('/register/me');
      if (res.success) {
        if (res.data.registrant) {
          updateRegistrant(res.data.registrant);
        }
        setLicenses(res.data.licenses);
      }
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to load dashboard data';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCompany = async (licenseId: string) => {
    try {
      setLaunchingLicenseId(licenseId);
      const payload = await launchRegistrantCompany(licenseId);
      toast.success(`Opened ${payload.company?.name || 'company'} successfully`);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Unable to open this company');
    } finally {
      setLaunchingLicenseId(null);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const activeLicenses = licenses.filter((l) => l.status === 'active' || l.status === 'trial');
  const pendingLicenses = licenses.filter((l) => l.status === 'pending');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900">
      {/* Nav */}
      <nav className="border-b border-white/10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-16 drop-shadow" />
            <span className="text-white font-semibold hidden sm:block">Microtechnique Accounts</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm hidden sm:block">{registrant?.email}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white">
            Welcome back, {registrant?.name?.split(' ')[0]}
          </h1>
          <p className="text-slate-400 mt-1">Manage your licenses and subscriptions</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            { label: 'Total Licenses', value: licenses.length, icon: CreditCard, color: 'text-purple-400' },
            { label: 'Active', value: activeLicenses.length, icon: CheckCircle2, color: 'text-emerald-400' },
            { label: 'Pending Payment', value: pendingLicenses.length, icon: Clock, color: 'text-amber-400' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white/5 border border-white/10 rounded-2xl p-6 flex items-center gap-4"
            >
              <stat.icon className={`w-8 h-8 ${stat.color}`} />
              <div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-slate-400 text-sm">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Pending payment alert */}
        {pendingLicenses.length > 0 && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 font-medium">
                  {pendingLicenses.length} license{pendingLicenses.length > 1 ? 's' : ''} awaiting payment
                </p>
                <p className="text-amber-400/70 text-sm">
                  Contact us to complete payment and activate your license.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 text-sm">
              <a
                href="tel:+916355997080"
                className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg transition-colors"
              >
                <Phone className="w-4 h-4" />
                +91 6355 997 080
              </a>
              <a
                href="mailto:support@microtechniqueit.com"
                className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg transition-colors"
              >
                <Mail className="w-4 h-4" />
                Email us
              </a>
            </div>
          </div>
        )}

        {/* Action — buy new license */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Your Licenses</h2>
          <Link
            to="/register/licenses"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white text-sm font-semibold rounded-lg transition-all"
          >
            <Plus className="w-4 h-4" />
            Buy New License
          </Link>
        </div>

        {/* License cards */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : loadError ? (
          <div className="text-center py-20 bg-white/5 border border-white/10 rounded-2xl">
            <AlertCircle className="w-14 h-14 text-amber-300 mx-auto mb-4 opacity-80" />
            <h3 className="text-white text-xl font-semibold mb-2">Couldn&apos;t load your dashboard</h3>
            <p className="text-slate-400 mb-6">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchData();
              }}
              className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-xl transition-all"
            >
              Try again
            </button>
          </div>
        ) : licenses.length === 0 ? (
          <div className="text-center py-20 bg-white/5 border border-white/10 rounded-2xl">
            <ShieldCheck className="w-16 h-16 text-purple-400 mx-auto mb-4 opacity-50" />
            <h3 className="text-white text-xl font-semibold mb-2">No licenses yet</h3>
            <p className="text-slate-400 mb-6">
              Purchase a license to get software access for you and your team.
            </p>
            <Link
              to="/register/licenses"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-xl transition-all"
            >
              <Plus className="w-5 h-5" />
              Explore License Plans
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {licenses.map((lic) => {
              const statusCfg = STATUS_CONFIG[lic.status] || STATUS_CONFIG.pending;
              const StatusIcon = statusCfg.icon;
              const tierColor = TIER_COLORS[lic.tier_name as keyof typeof TIER_COLORS] || 'from-purple-400 to-purple-300';
              const usedUsers = parseInt(lic.active_users) || 0;
              const canOpenCompany = !!lic.company_id && (lic.status === 'active' || lic.status === 'trial');

              return (
                <div
                  key={lic.id}
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4 hover:border-purple-500/40 transition-colors"
                >
                  {/* Tier badge + status */}
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r ${tierColor} text-slate-900 mb-2`}
                      >
                        {lic.tier_display_name} Plan
                      </span>
                      <p className="text-white font-semibold">
                        {lic.company_name || 'Awaiting activation'}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${statusCfg.className}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusCfg.label}
                    </span>
                  </div>

                  {/* Meta info */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-slate-400 text-xs mb-1">License Key</p>
                      <p className="text-white font-mono text-xs truncate">
                        {lic.license_key.slice(0, 8)}…{lic.license_key.slice(-4)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-slate-400 text-xs mb-1">Requested</p>
                      <p className="text-white text-xs">{formatDate(lic.requested_at)}</p>
                    </div>
                    {lic.status === 'active' && (
                      <>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                            <Users className="w-3 h-3" /> User Seats
                          </p>
                          <p className="text-white text-xs">
                            {usedUsers} / {lic.max_users} used
                          </p>
                          <div className="mt-1.5 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full"
                              style={{ width: `${Math.min((usedUsers / lic.max_users) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-slate-400 text-xs mb-1">Expires</p>
                          <p className="text-white text-xs">{formatDate(lic.expires_at)}</p>
                        </div>
                      </>
                    )}
                    {lic.company_id && (
                      <div className="bg-white/5 rounded-lg p-3 col-span-2">
                        <p className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> Company
                        </p>
                        <p className="text-white text-xs">{lic.company_name}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1 border-t border-white/10">
                    {canOpenCompany && (
                      <button
                        type="button"
                        onClick={() => handleOpenCompany(lic.id)}
                        disabled={launchingLicenseId === lic.id}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
                      >
                        {launchingLicenseId === lic.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                        Open company
                      </button>
                    )}
                    <Link
                      to={`/register/licenses/${lic.id}`}
                      className="flex items-center justify-between text-sm text-purple-400 hover:text-purple-300 transition-colors sm:ml-auto"
                    >
                      View details
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
