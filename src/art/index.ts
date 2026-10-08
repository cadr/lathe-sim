// Asset index. With Vite, a default import of an .svg is its URL string.
// TODO: once ../engine exports ToolId / TailstockToolId, replace the local unions
// with `import type { ToolId, TailstockToolId } from '../engine'`.
import toolNone from './icons/tool-none.svg'
import toolTurning from './icons/tool-turning.svg'
import toolParting from './icons/tool-parting.svg'
import toolBoring from './icons/tool-boring.svg'
import tsNone from './icons/ts-none.svg'
import tsCenterDrill from './icons/ts-center-drill.svg'
import tsDrillSmall from './icons/ts-drill-small.svg'
import tsDrillLarge from './icons/ts-drill-large.svg'
import tsLiveCenter from './icons/ts-live-center.svg'
import spindleFwd from './icons/spindle-fwd.svg'
import spindleRev from './icons/spindle-rev.svg'
import spindleOff from './icons/spindle-off.svg'
import zero from './icons/zero.svg'
import hint from './icons/hint.svg'
import check from './icons/check.svg'
import warning from './icons/warning.svg'
import crash from './icons/crash.svg'
import chuck from './icons/chuck.svg'
import carriage from './icons/carriage.svg'
import tailstock from './icons/tailstock.svg'
import headstock from './icons/headstock.svg'
import bed from './icons/bed.svg'
import handwheel from './icons/handwheel.svg'
import play from './icons/play.svg'
import pause from './icons/pause.svg'
import stepForward from './icons/step-forward.svg'
import restart from './icons/restart.svg'
import collectPart from './icons/collect-part.svg'
import loadStock from './icons/load-stock.svg'
import materialBrass from './icons/material-brass.svg'
import materialAluminum from './icons/material-aluminum.svg'
import materialSteel from './icons/material-steel.svg'
import materialDelrin from './icons/material-delrin.svg'
import logo from './logo.svg'
import handwheelWheel from './handwheel-wheel.svg'

export type ToolId = 'turning' | 'parting' | 'boring' | 'none'
export type TailstockToolId = 'none' | 'center-drill' | 'drill-1/8' | 'drill-1/4' | 'live-center'
export type MaterialId = 'brass' | 'aluminum' | 'steel' | 'delrin'

export const toolIcons: Record<ToolId, string> = {
  none: toolNone,
  turning: toolTurning,
  parting: toolParting,
  boring: toolBoring,
}

export const tailstockToolIcons: Record<TailstockToolId, string> = {
  none: tsNone,
  'center-drill': tsCenterDrill,
  'drill-1/8': tsDrillSmall,
  'drill-1/4': tsDrillLarge,
  'live-center': tsLiveCenter,
}

export const materialIcons: Record<MaterialId, string> = {
  brass: materialBrass,
  aluminum: materialAluminum,
  steel: materialSteel,
  delrin: materialDelrin,
}

export const uiIcons = {
  spindleFwd,
  spindleRev,
  spindleOff,
  zero,
  hint,
  check,
  warning,
  crash,
  chuck,
  carriage,
  tailstock,
  headstock,
  bed,
  handwheel,
  play,
  pause,
  stepForward,
  restart,
  collectPart,
  loadStock,
} as const

export { logo, handwheelWheel }
export * from './textures'
