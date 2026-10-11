import { SignInForm } from '@legalio/platform-console/components/SignInForm';

export function SystemLogin() {
  return <SignInForm allowRegistration={false} onOpenPrivacyPolicy={() => window.location.assign('/privacy')} onOpenTermsOfService={() => window.location.assign('/tos')} />;
}
