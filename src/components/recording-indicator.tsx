'use client';

import { Mic } from 'lucide-react';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import useRecordingStore from '@/stores/recording';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { RecordingDialog } from './recording-dialog';

export function RecordingIndicator() {
  const t = useTranslations('recording');
  const { isRecording, recordingDuration } = useRecordingStore();
  const [dialogOpen, setDialogOpen] = useState(false);

  //
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ，
  if (!isRecording) {
    return null;
  }

  //
  const handleClick = () => {
    setDialogOpen(true);
  };

  return (
    <>
      <SidebarMenuButton
        onClick={handleClick}
        className="md:h-8 md:p-0 relative animate-pulse"
        tooltip={{
          children: `${t('recording')} - ${formatDuration(recordingDuration)}`,
          hidden: false,
        }}
      >
        <div className="flex size-8 items-center justify-center rounded-lg">
          <div className="relative">
            <Mic className="size-4 text-red-500" />
            <div className="absolute -top-1 -right-1 size-2 rounded-full bg-red-500 animate-pulse" />
          </div>
        </div>
      </SidebarMenuButton>

      <RecordingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
