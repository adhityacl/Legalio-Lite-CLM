import { SignInForm } from '@legalio/platform-console/components/SignInForm';
import InteractiveGridBackground from '@legalio/platform-console/components/lightswind/interactive-grid-background';

export function SystemLogin() {
  return (
    <InteractiveGridBackground staticOnly gridSize={40} gridColor="#d1d5db" darkGridColor="#1f2937" showFade fadeIntensity={25} className="w-full bg-card" style={{ height: '100dvh' }}>
      <main className="flex h-full w-full flex-col items-center overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
        <SignInForm allowRegistration={false} onOpenPrivacyPolicy={() => window.location.assign('/privacy')} onOpenTermsOfService={() => window.location.assign('/tos')} />
      </main>
    </InteractiveGridBackground>
  );
}
