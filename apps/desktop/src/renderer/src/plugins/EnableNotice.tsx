import type { PluginSummary } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { buttonStyles, Modal } from '../components/Modal';

type Notice = NonNullable<PluginSummary['enableNotice']>;

interface EnableNoticeProps {
  pluginId: string;
  notice: Notice;
  open: boolean;
  onOpenChange(open: boolean): void;
  onAccept(): void;
}

function NoticeLink({ pluginId }: { pluginId: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="text-sm text-amber-600 hover:underline"
      onClick={() => void window.pb.plugins.openNotice(pluginId)}
    >
      {t('plugins.noticeMore')}
    </button>
  );
}

function NoticeButtons({ onCancel, onAccept }: { onCancel(): void; onAccept(): void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button type="button" className={buttonStyles.primary} onClick={onAccept}>
        {t('plugins.acceptAndEnable')}
      </button>
    </div>
  );
}

/**
 * Consent shown before turning on a plugin whose manifest has an `enableNotice`
 * (for example the license of the face models it downloads).
 */
export function EnableNotice({
  pluginId,
  notice,
  open,
  onOpenChange,
  onAccept,
}: EnableNoticeProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={notice.title}>
      <p
        className="text-sm whitespace-pre-line text-neutral-700 dark:text-neutral-200"
        data-testid="enable-notice"
      >
        {notice.body}
      </p>
      {notice.url && <NoticeLink pluginId={pluginId} />}
      <NoticeButtons onCancel={() => onOpenChange(false)} onAccept={onAccept} />
    </Modal>
  );
}
