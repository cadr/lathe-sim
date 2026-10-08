// Human text for events (toasts and the event log).
import type { LatheEvent } from '../engine';

const f3 = (v: number) => v.toFixed(3);

export function toastText(e: LatheEvent): string {
  switch (e.kind) {
    case 'crash':
      // with nothing in the toolpost it is the carriage itself that runs into things
      return `CRASH! The ${e.tool === 'none' ? 'carriage' : 'tool'} hit the ${e.what === 'chuck' ? 'chuck' : 'tailstock'}.`;
    case 'chatter':
      return `Chatter: ${Math.round(e.sfm)} sfm is too fast${e.rpm ? ` at ${e.rpm} rpm` : ''}. Drop the speed.`;
    case 'rubbing':
      return 'Rubbing: the tool touched the work with the spindle stopped.';
    case 'heavyCut':
      return `Heavy cut: ${f3(e.depth)}" deep (max ${f3(e.max)}"). Take lighter passes.`;
    case 'toolBroken':
      return 'Tool broken! Select the tool again to fit a fresh insert.';
    case 'poorFinish':
      return e.feedPerRev !== undefined && Number.isFinite(e.feedPerRev)
        ? `Poor finish: feeding ${e.feedPerRev.toFixed(3)}" per revolution (${e.feedRate.toFixed(2)} in/s) is too fast.`
        : `Poor finish: feeding ${e.feedRate.toFixed(2)} in/s is too fast.`;
    case 'boringSolid':
      return 'Boring bar broken! It needs a drilled hole to work in. It can\'t cut solid metal or the outside.';
    case 'wrongDirection':
      return 'Spindle is in reverse: a right-hand tool cuts upside down.';
    case 'parted':
      return 'Parted off! Collect the part from the chip tray.';
    case 'toolChangeWhileRunning':
      return 'Unsafe: stop the spindle before changing tools or stock.';
    case 'cut':
      return `Cut ${f3(e.depth)}" deep at ${Math.round(e.sfm)} sfm, ${e.feed.toFixed(2)} in/s.`;
    case 'stockLoaded':
      return 'Stock loaded.';
    case 'spindleOn':
      return 'Spindle on.';
    case 'spindleOff':
      return 'Spindle off.';
    case 'toolChanged':
      return `Tool changed: ${e.tool}.`;
  }
}
