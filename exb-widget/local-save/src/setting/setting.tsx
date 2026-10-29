import { jsx, hooks } from 'jimu-core'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { Switch, NumericInput, TextInput } from 'jimu-ui'
import { MapWidgetSelector, SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { type IMConfig, type Config, readConfig } from '../config'
import defaultMessages from './translations/default'

export default function Setting (props: AllWidgetSettingProps<IMConfig>) {
  const translate = hooks.useTranslation(defaultMessages)
  const config = readConfig(props.config as any)

  const onMapChange = (useMapWidgetIds: string[]) => {
    props.onSettingChange({ id: props.id, useMapWidgetIds })
  }

  const set = <K extends keyof Config>(key: K, value: Config[K]) => {
    props.onSettingChange({ id: props.id, config: props.config.set(key, value) })
  }

  return (
    <div className='widget-setting-local-save'>
      <SettingSection title={translate('lsSetMapSection')}>
        <SettingRow label={translate('lsSetMap')} flow='wrap'>
          <MapWidgetSelector useMapWidgetIds={props.useMapWidgetIds} onSelect={onMapChange} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('lsSetOptionsSection')}>
        <SettingRow>
          <p className='m-0 text-break'>{translate('lsSetAbout')}</p>
        </SettingRow>

        <SettingRow label={translate('lsSetIncludeDrawings')}>
          <Switch
            checked={config.includeDrawings}
            aria-label={translate('lsSetIncludeDrawings')}
            onChange={(evt: { target: { checked: boolean } }) => set('includeDrawings', evt.target.checked)}
          />
        </SettingRow>
        <SettingRow>
          <p className='m-0 text-break'>{translate('lsSetIncludeDrawingsHint')}</p>
        </SettingRow>

        <SettingRow label={translate('lsSetWarnBeforeLeaving')}>
          <Switch
            checked={config.warnBeforeLeaving}
            aria-label={translate('lsSetWarnBeforeLeaving')}
            onChange={(evt: { target: { checked: boolean } }) => set('warnBeforeLeaving', evt.target.checked)}
          />
        </SettingRow>

        <SettingRow label={translate('lsSetRespectPrivileges')}>
          <Switch
            checked={config.respectUserPrivileges}
            aria-label={translate('lsSetRespectPrivileges')}
            onChange={(evt: { target: { checked: boolean } }) => set('respectUserPrivileges', evt.target.checked)}
          />
        </SettingRow>
        <SettingRow>
          <p className='m-0 text-break'>{translate('lsSetRespectPrivilegesHint')}</p>
        </SettingRow>

        <SettingRow label={translate('lsSetMaxFeatures')} flow='wrap'>
          <NumericInput
            value={config.maxFeaturesPerLayer}
            min={1}
            max={50000}
            step={500}
            aria-label={translate('lsSetMaxFeatures')}
            onAcceptValue={(v: number) => set('maxFeaturesPerLayer', readConfig({ maxFeaturesPerLayer: Number(v) }).maxFeaturesPerLayer)}
          />
        </SettingRow>

        <SettingRow label={translate('lsSetMaxFileSize')} flow='wrap'>
          <NumericInput
            value={config.maxFileSizeMB}
            min={1}
            max={100}
            step={1}
            aria-label={translate('lsSetMaxFileSize')}
            onAcceptValue={(v: number) => set('maxFileSizeMB', readConfig({ maxFileSizeMB: Number(v) }).maxFileSizeMB)}
          />
        </SettingRow>

        <SettingRow label={translate('lsSetDefaultFileName')} flow='wrap'>
          <TextInput
            value={config.defaultFileName}
            aria-label={translate('lsSetDefaultFileName')}
            onAcceptValue={(v: string) => set('defaultFileName', v.trim() || 'my-map')}
          />
        </SettingRow>
      </SettingSection>
    </div>
  )
}
