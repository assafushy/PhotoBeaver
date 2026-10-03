import { useTranslation } from 'react-i18next';

export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section className="p-8">
      <h1 className="mb-2 text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="text-neutral-500 dark:text-neutral-400">{t('placeholder.comingSoon')}</p>
    </section>
  );
}
