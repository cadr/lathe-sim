// Help and Settings popovers in the app header.
import type { No3dSetting } from './settings';
import { Popover } from './Popover';
import styles from '../App.module.css';

export function HelpMenu() {
  return (
    <Popover label="Help" testId="app-help">
      <div className={styles.help}>
        <h2>How to drive the lathe</h2>
        <h3>Handwheels</h3>
        <ul>
          <li>
            <strong>Drag</strong> around a wheel to turn it. Each division is one thou (0.001&quot;).
          </li>
          <li>
            <strong>Mouse wheel</strong> over a wheel turns one division per notch (scrolling down is clockwise). Hold Shift for ten.
          </li>
          <li>
            <strong>Keys:</strong> focus a wheel, then ← / → (or ↓ / ↑) turn one division (→ is clockwise), Shift for ten, Page Up / Page Down for a full revolution.
          </li>
          <li>
            <strong>Buttons</strong> under each wheel step −1 rev, −10, −1, +1, +10 and +1 rev. Hold one to repeat, but a held button feeds fast: in a cut, click steadily instead.
          </li>
          <li>
            <strong>Zero</strong> resets that dial collar so you can count thou from where you are.
          </li>
        </ul>
        <h3>Which way is which</h3>
        <ul>
          <li>Cross slide (X): clockwise moves the tool in toward the center. One rev is 0.050&quot; of radius, 0.100&quot; on the diameter.</li>
          <li>Carriage (Z): clockwise moves toward the tailstock, counter-clockwise toward the chuck. One rev is 0.100&quot;.</li>
          <li>Tailstock: clockwise advances the quill toward the work. One rev is 0.100&quot;.</li>
          <li>The DRO shows X as a diameter (X dia) and as a radius. Z = 0 is the face of the chuck jaws.</li>
        </ul>
        <h3>Shop safety rules</h3>
        <ul>
          <li>Start the spindle before the tool touches the work. A stopped tool only rubs.</li>
          <li>Stop the spindle before changing tools or stock.</li>
          <li>Keep the tool at least 0.1&quot; clear of the chuck jaws. Parting tools need extra room.</li>
          <li>Take light passes: about 0.040&quot; roughing in brass, 0.005&quot; to finish. Too deep a cut raises a heavy-cut warning, and twice the limit breaks the tool.</li>
          <li>Drop the speed for big diameters and parting. Watch the SFM readout under the spindle switch.</li>
          <li>Feed steadily. Spinning a handwheel too fast leaves a poor finish.</li>
        </ul>
        <h3>Lessons and challenges</h3>
        <ul>
          <li>Watch a lesson to see each job done, or choose Do it yourself and follow the &quot;Waiting until&quot; line in each step. Show me plays just that step.</li>
          <li>While a demo plays, the controls are locked. Pause it, or press Take over, to drive the machine yourself.</li>
          <li>In a challenge, Hint names the next step. Ask again for the numbers. Check my part measures and grades your work.</li>
        </ul>
      </div>
    </Popover>
  );
}

export function SettingsMenu({ no3d }: { no3d: No3dSetting }) {
  return (
    <Popover label="Settings" testId="app-settings">
      <div className={styles.settings}>
        <label className={styles.settingRow}>
          <input
            type="checkbox"
            data-testid="setting-no3d"
            checked={no3d.off}
            disabled={no3d.forced}
            onChange={(e) => no3d.setSaved(e.target.checked)}
          />
          Turn off the 3D view
        </label>
        <p className={styles.helpNote}>
          {no3d.forced
            ? 'Turned off by the ?no3d=1 address parameter.'
            : 'Hides the 3D view and its animation. Handy on slow computers. The section view and DRO still show everything.'}
        </p>
      </div>
    </Popover>
  );
}
