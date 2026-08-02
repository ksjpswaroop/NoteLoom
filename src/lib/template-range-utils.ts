import { GenTemplateRange } from '@/stores/setting';

/**
 * 
 * @param range 
 * @param t 
 * @returns 
 */
export function getTemplateRangeLabel(range: GenTemplateRange, t: (key: string) => string): string {
  const keyMap = {
    [GenTemplateRange.All]: 'settings.template.range.all',
    [GenTemplateRange.Today]: 'settings.template.range.today',
    [GenTemplateRange.Week]: 'settings.template.range.week',
    [GenTemplateRange.Month]: 'settings.template.range.month',
    [GenTemplateRange.ThreeMonth]: 'settings.template.range.threeMonth',
    [GenTemplateRange.Year]: 'settings.template.range.year',
  };
  if (!Object.values(GenTemplateRange).includes(range)) {
    return t('settings.template.range.all');
  }
  
  return t(keyMap[range]);
}

/**
 * 
 * @param t 
 * @returns 
 */
export function getTemplateRangeOptions(t: (key: string) => string) {
  return Object.values(GenTemplateRange).map(value => ({
    value,
    label: getTemplateRangeLabel(value, t)
  }));
}
