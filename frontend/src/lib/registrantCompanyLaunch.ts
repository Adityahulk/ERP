import registrantApi from '@/lib/registrantApi';
import { useAuthStore } from '@/store/authStore';

type LaunchResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar_url?: string | null;
  };
  company: {
    id: string;
    name: string;
    gstin?: string | null;
    logo_url?: string | null;
    item_terminology?: string | null;
    item_terminology_plural?: string | null;
    onboarding_completed?: boolean | null;
  } | null;
  accessToken: string;
  refreshToken: string;
};

export async function launchRegistrantCompany(licenseId: string) {
  const { data: res } = await registrantApi.post(`/register/licenses/${licenseId}/launch`);
  const payload: LaunchResponse = res.data;
  const { login, setLicense } = useAuthStore.getState();

  login(
    {
      id: payload.user.id,
      companyId: payload.company?.id ?? null,
      name: payload.user.name,
      email: payload.user.email,
      role: payload.user.role,
      avatarUrl: payload.user.avatar_url ?? undefined,
    },
    payload.company
      ? {
          id: payload.company.id,
          name: payload.company.name,
          gstin: payload.company.gstin ?? undefined,
          logoUrl: payload.company.logo_url ?? undefined,
          itemTerminology: payload.company.item_terminology || 'Item',
          itemTerminologyPlural: payload.company.item_terminology_plural || 'Items',
          onboardingCompleted: Boolean((payload.company as any).onboarding_completed),
        }
      : null,
    payload.accessToken,
    payload.refreshToken
  );

  setLicense(null);
  return payload;
}
