import { useState } from 'react';
// import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { CheckCircle2, Building2, MapPin, Zap, ArrowRight, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import toast from 'react-hot-toast';
import api from '@/lib/api';

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // States
  const [company, setCompany] = useState({ name: '', type: '', gst: '', state: '' });
  const [location, setLocation] = useState({ name: 'Main Branch', city: '', pin: '' });
  const [quickSetup, setQuickSetup] = useState({ items: true, coa: true, leaves: true });

  const completeOnboarding = async () => {
    try {
      setLoading(true);
      await api.patch('/company/onboarding', {
        company: {
          name: company.name.trim(),
          business_type: company.type?.trim() || null,
          gstin: company.gst?.trim() || null,
          state_code: company.state,
        },
        location: {
          name: location.name.trim(),
          city: location.city?.trim() || null,
          pincode: location.pin?.trim() || null,
        },
        seed: {
          items: quickSetup.items,
          coa: quickSetup.coa,
          leaves: quickSetup.leaves,
        },
      });
      toast.success('All set! Welcome to BizFlow.');
      window.location.href = '/dashboard';
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to finalize wizard.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-xl">
        
        {/* Progress header */}
        <div className="flex justify-between items-center mb-8 px-4 relative">
          <div className="absolute top-1/2 left-0 w-full h-[2px] bg-slate-200 -z-10 -translate-y-1/2 rounded"></div>
          <div className="absolute top-1/2 left-0 h-[2px] bg-indigo-600 -z-10 -translate-y-1/2 transition-all duration-500 rounded" style={{ width: `${((step - 1) / 3) * 100}%`}}></div>
          
          {[1,2,3,4].map(s => (
             <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${step >= s ? 'bg-indigo-600 border-indigo-600 text-white shadow-md ring-4 ring-indigo-50' : 'bg-white border-slate-300 text-slate-400'}`}>
                {step > s ? <CheckCircle2 className="w-4 h-4"/> : s}
             </div>
          ))}
        </div>

        <Card className="shadow-2xl border-0 overflow-hidden ring-1 ring-slate-900/5">
           {step === 1 && (
              <div className="p-8 animate-in slide-in-from-right-4 duration-300">
                 <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2"><Building2 className="text-indigo-500" /> Business Details</h2>
                 <p className="text-slate-500 text-sm mb-6">Let's set up the core identity of your enterprise.</p>
                 
                 <div className="space-y-4">
                    <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 flex flex-col items-center justify-center text-slate-500 hover:bg-slate-50 transition cursor-pointer">
                       <Upload className="w-6 h-6 mb-2 text-indigo-400" />
                       <span className="text-sm font-medium">Upload Company Logo</span>
                    </div>

                    <div>
                       <label className="text-sm font-medium text-slate-700">Company Name *</label>
                       <Input value={company.name} onChange={e => setCompany({...company, name: e.target.value})} className="mt-1 h-11" placeholder="Acme Corp" />
                    </div>
                    <div>
                       <label className="text-sm font-medium text-slate-700">GSTIN / Tax ID</label>
                       <Input value={company.gst} onChange={e => setCompany({...company, gst: e.target.value})} className="mt-1 h-11 uppercase" placeholder="Optional" />
                    </div>
                    <div>
                       <label className="text-sm font-medium text-slate-700">Operating State *</label>
                       <select value={company.state} onChange={e => setCompany({...company, state: e.target.value})} className="w-full mt-1 h-11 rounded-md border border-slate-200 px-3">
                          <option value="">Select State (GST code)</option>
                          <option value="27">Maharashtra (27)</option>
                          <option value="07">Delhi (07)</option>
                          <option value="29">Karnataka (29)</option>
                       </select>
                    </div>
                 </div>
                 <Button onClick={() => setStep(2)} disabled={!company.name || !company.state} className="w-full mt-8 h-12 text-lg">Next <ArrowRight className="w-4 h-4 ml-2"/></Button>
              </div>
           )}

           {step === 2 && (
              <div className="p-8 animate-in slide-in-from-right-4 duration-300">
                 <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2"><MapPin className="text-indigo-500" /> Primary Location</h2>
                 <p className="text-slate-500 text-sm mb-6">Where is your main warehouse or storefront located?</p>
                 
                 <div className="space-y-4">
                    <div>
                       <label className="text-sm font-medium text-slate-700">Location Name *</label>
                       <Input value={location.name} onChange={e => setLocation({...location, name: e.target.value})} className="mt-1 h-11" placeholder="e.g. Main Branch" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="text-sm font-medium text-slate-700">City</label>
                          <Input value={location.city} onChange={e => setLocation({...location, city: e.target.value})} className="mt-1 h-11" />
                       </div>
                       <div>
                          <label className="text-sm font-medium text-slate-700">Pincode</label>
                          <Input value={location.pin} onChange={e => setLocation({...location, pin: e.target.value})} className="mt-1 h-11" />
                       </div>
                    </div>
                 </div>
                 <div className="flex gap-3 mt-8">
                    <Button variant="outline" onClick={() => setStep(1)} className="h-12 w-1/3">Back</Button>
                    <Button onClick={() => setStep(3)} disabled={!location.name} className="h-12 w-2/3">Next <ArrowRight className="w-4 h-4 ml-2"/></Button>
                 </div>
              </div>
           )}

           {step === 3 && (
              <div className="p-8 animate-in slide-in-from-right-4 duration-300">
                 <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2"><Zap className="text-indigo-500" /> Quick Defaults</h2>
                 <p className="text-slate-500 text-sm mb-6">We can automatically pre-wire core ERP structures for you.</p>
                 
                 <div className="space-y-3">
                    <label className="flex items-start gap-3 p-4 border rounded-lg hover:bg-slate-50 cursor-pointer transition">
                       <input type="checkbox" checked={quickSetup.items} onChange={e => setQuickSetup({...quickSetup, items: e.target.checked})} className="mt-1 w-5 h-5 accent-indigo-600 rounded" />
                       <div>
                          <p className="font-semibold text-slate-800">Seed sample inventory</p>
                          <p className="text-xs text-slate-500 mt-1">Loads 5 demo products into your database for testing</p>
                       </div>
                    </label>
                    <label className="flex items-start gap-3 p-4 border rounded-lg hover:bg-slate-50 cursor-pointer transition">
                       <input type="checkbox" checked={quickSetup.coa} onChange={e => setQuickSetup({...quickSetup, coa: e.target.checked})} className="mt-1 w-5 h-5 accent-indigo-600 rounded" />
                       <div>
                          <p className="font-semibold text-slate-800">Install Standard Chart of Accounts</p>
                          <p className="text-xs text-slate-500 mt-1">Populates standard Assets, Liabilities, and Equity hierarchies</p>
                       </div>
                    </label>
                    <label className="flex items-start gap-3 p-4 border rounded-lg hover:bg-slate-50 cursor-pointer transition">
                       <input type="checkbox" checked={quickSetup.leaves} onChange={e => setQuickSetup({...quickSetup, leaves: e.target.checked})} className="mt-1 w-5 h-5 accent-indigo-600 rounded" />
                       <div>
                          <p className="font-semibold text-slate-800">Configure HR Leaves</p>
                          <p className="text-xs text-slate-500 mt-1">Adds standard Casual, Sick, and Earned parameters</p>
                       </div>
                    </label>
                 </div>
                 
                 <div className="flex gap-3 mt-8">
                    <Button variant="outline" onClick={() => setStep(2)} className="h-12 w-1/3">Back</Button>
                    <Button onClick={() => setStep(4)} className="h-12 w-2/3">Finalize Context <ArrowRight className="w-4 h-4 ml-2"/></Button>
                 </div>
              </div>
           )}

           {step === 4 && (
              <div className="p-8 text-center animate-in zoom-in-95 duration-500">
                 <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                 </div>
                 <h2 className="text-3xl font-bold text-slate-900 mb-2">You're Ready!</h2>
                 <p className="text-slate-500 mb-8 max-w-sm mx-auto">Welcome to Microtechnique IT, {company.name}. The workspace is fully booted.</p>
                 
                 <div className="grid gap-3 max-w-sm mx-auto">
                    <Button onClick={completeOnboarding} loading={loading} className="h-14 text-lg bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200">
                       Enter Dashboard
                    </Button>
                    <Button variant="outline" onClick={completeOnboarding} loading={loading} className="h-12 text-slate-600 border-dashed">
                       Jump straight to POS Billing
                    </Button>
                 </div>
              </div>
           )}
        </Card>
      </div>
    </div>
  );
}
