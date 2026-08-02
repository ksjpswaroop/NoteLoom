'use client'

import { useTranslations } from 'next-intl'
import { MonitorSmartphone } from 'lucide-react'
import { SettingType } from '../components/setting-base'
import { AutomationsSettings } from './automations-settings'

export default function AutomationsSettingPage() {
  const t = useTranslations('settings.automations')

  return (
    <SettingType
      id="automations"
      title={t('title')}
      desc={t('desc')}
      icon={<MonitorSmartphone />}
    >
      <AutomationsSettings />
    </SettingType>
  )
}
