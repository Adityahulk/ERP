import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, CheckCircle2, XCircle,
  Loader2, Star, Zap, Diamond, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';
import { useRegistrantStore } from '@/store/registrantStore';

interface TierFeature {
  key: string;
  label: string;
  included: boolean;
}

interface Tier {
  id: string;
  name: string;
  display_name: string;
  max_users: number;
  price_inr: number;
  description: string;
  features: TierFeature[];
}

interface ContactInfo {
  phone: string;
  email: string;
}

const TIER_META: Record<string, { icon: any; gradient: string; badge?: string; ring: string }> = {
  silver: {
    icon: Star,
    gradient: 'from-slate-500 to-slate-400',
    ring: 'ring-slate-500/30',
  },
  gold: {
    icon: Zap,
    gradient: 'from-yellow-500 to-amber-400',
    badge: 'Most Popular',
    ring: 'ring-yellow-500/40',
  },
  diamond: {
    icon: Diamond,
    gradient: 'from-cyan-500 to-blue-500',
    badge: 'Best Value',
    ring: 'ring-cyan-500/30',
  },
};

function formatPrice(inr: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(inr);
}

export default function LicenseTiersPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useRegistrantStore();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [requestedLicense, setRequestedLicense] = useState<any>(null);

  useEffect(() => {
    fetchTiers();
  }, []);

  const fetchTiers = async () => {
    try {
      const { data: res } = await registrantApi.get('/licenses/tiers');
      if (res.success) {
        setTiers(res.data.tiers);
        setContact(res.data.contact);
      }
    } catch {
      toast.error('Failed to load license plans');
    } finally {
      setLoading(false);
    }
  };

  const handleBuyClick = (tier: Tier) => {
    if (!isAuthenticated) {
      toast('Please register or sign in first', { icon: '🔑' });
      navigate('/register');
      return;
    }
    setSelectedTier(tier);
  };

  const handleRequestLicense = async () => {
    if (!selectedTier) return;
    setRequesting(true);
    try {
      const { data: res } = await registrantApi.post('/licenses/request', { tier_id: selectedTier.id });
      if (res.success) {
        setRequestedLicense(res.data.license);
        setSelectedTier(null);
        setShowContactModal(true);
        toast.success('License request submitted!');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900">
      {/* Nav */}
      <div className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/register/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-20 drop-shadow" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-14">
        {/* Header */}
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold text-white mb-4">Choose Your Plan</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Select the plan that fits your business. All plans include full data isolation — your data stays yours.
          </p>
          {contact && (
            <div className="flex items-center justify-center gap-4 mt-6 flex-wrap">
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200 text-sm transition-colors"
              >
                <Phone className="w-4 h-4" />
                {contact.phone}
              </a>
              <span className="text-white/20">|</span>
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200 text-sm transition-colors"
              >
                <Mail className="w-4 h-4" />
                {contact.email}
              </a>
            </div>
          )}
        </div>

        {/* Tiers grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tiers.map((tier) => {
              const meta = TIER_META[tier.name] || TIER_META.silver;
              const TierIcon = meta.icon;
              const includedFeatures = tier.features.filter((f) => f.included);
              const excludedFeatures = tier.features.filter((f) => !f.included);

              return (
                <div
                  key={tier.id}
                  className={`relative bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col ring-1 ${meta.ring} hover:border-white/20 transition-all`}
                >
                  {meta.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className={`px-4 py-1 rounded-full text-xs font-bold bg-gradient-to-r ${meta.gradient} text-slate-900`}>
                        {meta.badge}
                      </span>
                    </div>
                  )}

                  {/* Tier header */}
                  <div className="mb-6">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center mb-4`}>
                      <TierIcon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-1">{tier.display_name}</h3>
                    <p className="text-slate-400 text-sm">{tier.description}</p>
                  </div>

                  {/* Price */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-white">{formatPrice(tier.price_inr)}</span>
                      <span className="text-slate-400">/year</span>
                    </div>
                    <p className="text-purple-300 text-sm mt-1">{tier.max_users} user seats included</p>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {includedFeatures.map((f) => (
                      <li key={f.key} className="flex items-center gap-2.5 text-sm text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        {f.label}
                      </li>
                    ))}
                    {excludedFeatures.map((f) => (
                      <li key={f.key} className="flex items-center gap-2.5 text-sm text-slate-500">
                        <XCircle className="w-4 h-4 text-slate-600 flex-shrink-0" />
                        {f.label}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleBuyClick(tier)}
                    className={`w-full py-3 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r ${meta.gradient} text-slate-900 hover:opacity-90 hover:shadow-lg`}
                  >
                    Buy {tier.display_name} Plan
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-slate-500 text-sm mt-10">
          All payments are processed offline via call/email. Our team will contact you within 24 hours.
        </p>
      </div>

      {/* Confirm request modal */}
      {selectedTier && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/20 rounded-2xl p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-2">
              Request {selectedTier.display_name} Plan
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              We'll create a license request for you. Our sales team will reach out to complete payment and activate your account.
            </p>

            <div className="bg-white/5 rounded-xl p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Plan</span>
                <span className="text-white font-medium">{selectedTier.display_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">User seats</span>
                <span className="text-white font-medium">{selectedTier.max_users} users</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Annual price</span>
                <span className="text-white font-medium">{formatPrice(selectedTier.price_inr)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedTier(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/20 text-slate-300 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestLicense}
                disabled={requesting}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#420662] to-purple-600 text-white font-semibold text-sm transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {requesting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact modal after request */}
      {showContactModal && contact && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/20 rounded-2xl p-8 max-w-md w-full relative">
            <button
              onClick={() => { setShowContactModal(false); navigate('/register/dashboard'); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center mb-6">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Request Submitted!</h3>
              <p className="text-slate-400 text-sm">
                Your license request has been received. Contact us to complete payment and activate.
              </p>
              {requestedLicense && (
                <p className="text-purple-300 text-sm mt-2 font-mono">
                  Reference: {requestedLicense.license_key?.slice(0, 12)}…
                </p>
              )}
            </div>

            <div className="space-y-3">
              <a
                href={`tel:${contact.phone}`}
                className="flex items-center gap-3 w-full px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white transition-colors"
              >
                <Phone className="w-5 h-5 text-purple-400" />
                <div className="text-left">
                  <p className="text-xs text-slate-400">Call us at</p>
                  <p className="font-semibold">{contact.phone}</p>
                </div>
              </a>
              <a
                href={`mailto:${contact.email}?subject=License Activation - ${requestedLicense?.license_key}`}
                className="flex items-center gap-3 w-full px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white transition-colors"
              >
                <Mail className="w-5 h-5 text-purple-400" />
                <div className="text-left">
                  <p className="text-xs text-slate-400">Email us at</p>
                  <p className="font-semibold">{contact.email}</p>
                </div>
              </a>
            </div>

            <button
              onClick={() => { setShowContactModal(false); navigate('/register/dashboard'); }}
              className="w-full mt-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
            >
              View my licenses →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
