import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { Gauge, Volume2, Mic, Cpu, Languages, Download } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useSettingStore from "@/stores/setting";
import { ResponsiveSelect } from "@/components/responsive-select";
import type { SpeechMode } from '@/lib/speech/types';
import { SettingSection } from '../components/setting-base'
import { Button } from '@/components/ui/button';
import {
  PARAKEET_MODEL_OPTIONS,
  type LocalSttEngine,
  type ParakeetAttentionMode,
} from '@/lib/speech/parakeet-models';
import { ensureParakeetStt, inspectParakeetStt, type ParakeetStatus } from '@/lib/speech/parakeet';

export function Setting() {
  const t = useTranslations('settings.audio');
  const {
    audioModel,
    textToSpeechMode,
    speechToTextMode,
    localSttEngine,
    parakeetModelId,
    parakeetLanguage,
    parakeetAttentionMode,
    setAiModelList,
    setTextToSpeechMode,
    setSpeechToTextMode,
    setLocalSttEngine,
    setParakeetModelId,
    setParakeetLanguage,
    setParakeetAttentionMode,
  } = useSettingStore();
  const [speed, setSpeed] = useState(1);
  const [parakeetStatus, setParakeetStatus] = useState<ParakeetStatus | null>(null);
  const [isInstallingParakeet, setIsInstallingParakeet] = useState(false);
  const [parakeetActionError, setParakeetActionError] = useState<string | null>(null);

  const modeOptions: Array<{ value: SpeechMode; label: string }> = [
    { value: 'auto', label: t('mode.auto') },
    { value: 'local', label: t('mode.local') },
    { value: 'model', label: t('mode.model') },
  ];

  const localEngineOptions: Array<{ value: LocalSttEngine; label: string }> = [
    { value: 'parakeet', label: t('stt.localEngine.parakeet') },
    { value: 'browser', label: t('stt.localEngine.browser') },
  ];

  const parakeetModelOptions = PARAKEET_MODEL_OPTIONS.map(option => ({
    value: option.id,
    label: option.label,
  }));

  const languageOptions = [
    { value: 'en', label: t('stt.parakeet.languageEnglish') },
  ];

  const attentionOptions: Array<{ value: ParakeetAttentionMode; label: string }> = [
    { value: 'full', label: t('stt.parakeet.attentionFull') },
    { value: 'local', label: t('stt.parakeet.attentionLocal') },
  ];

  const refreshParakeetStatus = useCallback(async () => {
    try {
      const status = await inspectParakeetStt(parakeetModelId);
      setParakeetStatus(status);
      setParakeetActionError(null);
    } catch (error) {
      setParakeetActionError(error instanceof Error ? error.message : t('stt.parakeet.statusError'));
    }
  }, [parakeetModelId, t]);

  useEffect(() => {
    void refreshParakeetStatus();
  }, [refreshParakeetStatus]);

  // TTS
  useEffect(() => {
    async function loadSpeed() {
      if (!audioModel) return;
      const store = await Store.load('store.json');
      const models = await store.get<any[]>('aiModelList');
      if (!models) return;
      
      // TTS，
      let currentSpeed = 1;
      for (const config of models) {
        // models
        if (config.models && config.models.length > 0) {
          const targetModel = config.models.find((model: any) => 
            model.id === audioModel && model.modelType === 'tts'
          );
          if (targetModel && targetModel.speed !== undefined) {
            currentSpeed = targetModel.speed;
            break;
          }
        } else {
          // ：
          if (config.key === audioModel && config.modelType === 'tts' && config.speed !== undefined) {
            currentSpeed = config.speed;
            break;
          }
        }
      }
      
      setSpeed(currentSpeed);
      setAiModelList(models);
    }
    loadSpeed();
  }, [audioModel]);

  // TTS
  const handleSpeedChange = async (value: number[]) => {
    const newSpeed = value[0];
    setSpeed(newSpeed);
    
    if (!audioModel) return;
    
    const store = await Store.load('store.json');
    const models = await store.get<any[]>('aiModelList') || [];
    
    // TTS，
    const updatedModels = models.map(config => {
      // models
      if (config.models && config.models.length > 0) {
        const updatedConfig = { ...config };
        updatedConfig.models = config.models.map((model: any) => {
          if (model.id === audioModel && model.modelType === 'tts') {
            return { ...model, speed: newSpeed };
          }
          return model;
        });
        return updatedConfig;
      } else {
        // ：
        if (config.key === audioModel && config.modelType === 'tts') {
          return { ...config, speed: newSpeed };
        }
        return config;
      }
    });
    
    setAiModelList(updatedModels);
    await store.set('aiModelList', updatedModels);
    await store.save();
  };

  const handleInstallParakeet = async () => {
    setIsInstallingParakeet(true);
    setParakeetActionError(null);
    try {
      const result = await ensureParakeetStt(parakeetModelId);
      setParakeetStatus(result.status);
      if (!result.success) {
        setParakeetActionError(result.status.message || t('stt.parakeet.installFailed'));
      }
    } catch (error) {
      setParakeetActionError(error instanceof Error ? error.message : t('stt.parakeet.installFailed'));
    } finally {
      setIsInstallingParakeet(false);
    }
  };

  const showParakeetSettings = localSttEngine === 'parakeet' && speechToTextMode !== 'model';
  const selectedParakeetModel = PARAKEET_MODEL_OPTIONS.find(option => option.id === parakeetModelId);

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title={t('tts.title')} desc={t('tts.desc')}>
        <ItemGroup>
        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('mode.title')}</ItemTitle>
            <ItemDescription>{t('tts.modeDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ResponsiveSelect
              title={t('mode.title')}
              value={textToSpeechMode}
              onValueChange={value => setTextToSpeechMode(value as SpeechMode)}
              className="w-full sm:w-[180px]"
              options={modeOptions}
            />
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('tts.model.title')}</ItemTitle>
            <ItemDescription>{t('tts.model.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="tts" />
          </ItemActions>
        </Item>

        {audioModel && (
          <Item variant="outline">
            <ItemMedia variant="icon"><Gauge className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('tts.speed.title')}</ItemTitle>
              <ItemDescription>{t('tts.speed.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="flex items-center gap-4">
                <Slider
                  value={[speed]}
                  onValueChange={handleSpeedChange}
                  min={0.5}
                  max={2}
                  step={0.1}
                  className="w-full sm:w-[180px]"
                />
                <span className="text-zinc-500 w-10">{speed}x</span>
              </div>
            </ItemActions>
          </Item>
        )}
        </ItemGroup>
      </SettingSection>

      <SettingSection title={t('stt.title')} desc={t('stt.desc')}>
        <ItemGroup>
        <Item variant="outline">
          <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('mode.title')}</ItemTitle>
            <ItemDescription>{t('stt.modeDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ResponsiveSelect
              title={t('mode.title')}
              value={speechToTextMode}
              onValueChange={value => setSpeechToTextMode(value as SpeechMode)}
              className="w-full sm:w-[180px]"
              options={modeOptions}
            />
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><Cpu className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('stt.localEngine.title')}</ItemTitle>
            <ItemDescription>{t('stt.localEngine.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ResponsiveSelect
              title={t('stt.localEngine.title')}
              value={localSttEngine}
              onValueChange={value => setLocalSttEngine(value as LocalSttEngine)}
              className="w-full sm:w-[220px]"
              options={localEngineOptions}
            />
          </ItemActions>
        </Item>

        {showParakeetSettings && (
          <>
            <Item variant="outline">
              <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.parakeet.model.title')}</ItemTitle>
                <ItemDescription>
                  {selectedParakeetModel?.description || t('stt.parakeet.model.desc')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ResponsiveSelect
                  title={t('stt.parakeet.model.title')}
                  value={parakeetModelId}
                  onValueChange={value => setParakeetModelId(value)}
                  className="w-full sm:w-[280px]"
                  options={parakeetModelOptions}
                />
              </ItemActions>
            </Item>

            <Item variant="outline">
              <ItemMedia variant="icon"><Languages className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.parakeet.language.title')}</ItemTitle>
                <ItemDescription>{t('stt.parakeet.language.desc')}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ResponsiveSelect
                  title={t('stt.parakeet.language.title')}
                  value={parakeetLanguage}
                  onValueChange={value => setParakeetLanguage(value)}
                  className="w-full sm:w-[180px]"
                  options={languageOptions}
                />
              </ItemActions>
            </Item>

            <Item variant="outline">
              <ItemMedia variant="icon"><Cpu className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.parakeet.attention.title')}</ItemTitle>
                <ItemDescription>{t('stt.parakeet.attention.desc')}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ResponsiveSelect
                  title={t('stt.parakeet.attention.title')}
                  value={parakeetAttentionMode}
                  onValueChange={value => setParakeetAttentionMode(value as ParakeetAttentionMode)}
                  className="w-full sm:w-[180px]"
                  options={attentionOptions}
                />
              </ItemActions>
            </Item>

            <Item variant="outline">
              <ItemMedia variant="icon"><Download className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.parakeet.runtime.title')}</ItemTitle>
                <ItemDescription>
                  {parakeetActionError || parakeetStatus?.message || t('stt.parakeet.runtime.checking')}
                  {parakeetStatus?.platform ? ` (${parakeetStatus.platform})` : ''}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshParakeetStatus()}
                    disabled={isInstallingParakeet}
                  >
                    {t('stt.parakeet.refresh')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleInstallParakeet()}
                    disabled={isInstallingParakeet || parakeetStatus?.supportedPlatform === false}
                  >
                    {isInstallingParakeet
                      ? t('stt.parakeet.installing')
                      : parakeetStatus?.runtimeReady
                        ? t('stt.parakeet.reinstall')
                        : t('stt.parakeet.install')}
                  </Button>
                </div>
              </ItemActions>
            </Item>
          </>
        )}

        {(speechToTextMode === 'model' || speechToTextMode === 'auto') && (
          <Item variant="outline">
            <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('stt.model.title')}</ItemTitle>
              <ItemDescription>{t('stt.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="stt" />
            </ItemActions>
          </Item>
        )}
        </ItemGroup>
      </SettingSection>
    </div>
  )
}
