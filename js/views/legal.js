// Privacy Policy, Terms of Service, Storage & Cookies and Account deletion.
//
// These describe what the app actually does (see the code and supabase/). They are
// drafts: details about who runs DailyMate come from LEGAL in config.js and show as
// marked placeholders until filled in, and the texts need professional review
// before a commercial launch.

import * as cloud from '../cloud.js';
import * as sync from '../sync.js';
import * as push from '../push.js';
import { LEGAL } from '../config.js';
import { esc, icon, toast } from '../ui.js';

const slot = (value, label) => (value ? esc(value) : `<mark class="placeholder">[${esc(label)} — to be added]</mark>`);
const operator = () => slot(LEGAL.operator, 'operator’s legal name');
const contact = () => (LEGAL.contactEmail ? `<a href="mailto:${esc(LEGAL.contactEmail)}">${esc(LEGAL.contactEmail)}</a>` : slot('', 'contact email'));
const updated = () => esc(new Intl.DateTimeFormat('en-CA', { dateStyle: 'long' }).format(new Date(`${LEGAL.lastUpdated}T12:00:00`)));

const draftNote = () => `
  <p class="form-msg form-msg--info">${icon('alert')}<span>This document is a working draft. It describes how DailyMate works today and will be reviewed before paid plans launch.</span></p>`;

function page(heading, subtitle, body) {
  return `
    <div class="page page--narrow">
      <header class="page-head">
        <div>
          <h1 class="page-title">${heading}</h1>
          <p class="page-subtitle">${subtitle}</p>
        </div>
      </header>
      <article class="card legal">${body}</article>
    </div>`;
}

// ---- Privacy Policy ------------------------------------------------------------------------

function privacy() {
  return page('Privacy Policy', `Last updated ${updated()}`, `
    ${draftNote()}
    <p>DailyMate is a day planner run by ${operator()} (“we”). This policy explains what information DailyMate handles, why, where it is kept and the choices you have.
      It is written for people in Canada.</p>

    <h2>Using DailyMate without an account</h2>
    <p>You can use DailyMate without signing up. Your tasks, lists, reminders and name are then saved <strong>only in your browser</strong> on your device
      (in “local storage”). We don’t receive them. Clearing your browser data deletes them.</p>

    <h2>What we collect when you create an account</h2>
    <ul>
      <li><strong>Account details:</strong> your email address, the name you give (optional) and a password. The password is stored only as a secure hash by our authentication provider; we can’t read it.</li>
      <li><strong>Your content:</strong> tasks, lists, reminders, your display name and time zones of reminders — so they can be kept in sync between your devices.</li>
      <li><strong>Notification details</strong> (only if you turn on notifications): an address and keys your browser creates for receiving push messages, and a label such as “Chrome on Android”.
        We keep a delivery record (time and result) for each notification.</li>
      <li><strong>Activity dates:</strong> the dates on which you opened DailyMate while signed in (only the date — no times, pages or devices),
        used only in combined statistics such as “active users this week”. Kept for about 13 months.</li>
      <li><strong>Technical records:</strong> sign-in times, and server logs that our providers keep for security and troubleshooting (they include IP addresses and browser type).</li>
    </ul>
    <p>We don’t use advertising, analytics or tracking tools, and we don’t sell or rent personal information.</p>

    <h2>Why we use it</h2>
    <ul>
      <li>To provide the service: sign-in, saving and syncing your content, and sending the reminders you set.</li>
      <li>To keep DailyMate secure and working, and to answer your questions.</li>
      <li>To send account emails you need (confirming your address, resetting your password). We don’t send marketing emails.</li>
      <li>To let the operator know about new registrations: when an account is created, an email with its address, name (if given) and sign-up time is sent to the operator’s own mailbox.</li>
    </ul>
    <p>We rely on your consent, which you give by creating an account and by turning on notifications, and you can withdraw it at any time by turning notifications off or deleting your account.</p>

    <h2>Where it is stored and who processes it</h2>
    <ul>
      <li><strong>Supabase</strong> (database, sign-in, server functions) — our data is hosted in Canada (AWS ca-central-1, Montréal). Supabase is based in the United States and may access data from outside Canada to operate the service.</li>
      <li><strong>Resend</strong> (Resend, Inc., United States) sends the operator’s new-registration emails.</li>
      <li><strong>GitHub Pages</strong> (GitHub, Inc., United States) delivers the app’s files to your browser and keeps standard access logs.</li>
      <li><strong>Push services</strong> run by your browser’s maker — Google (Chrome, Edge on Android), Mozilla (Firefox), Microsoft (Edge on Windows) or Apple (Safari) — carry notifications to your device.
        The text of each notification is encrypted so that only your device can read it.</li>
    </ul>
    <p>Information processed outside Canada may be accessible to courts and authorities there under their laws.</p>

    <h2>How long we keep it</h2>
    <ul>
      <li>Your account and content: until you delete them or your account.</li>
      <li>Deleted items: a short “deleted” marker without the content is kept for up to 90 days so your other devices also remove the item.</li>
      <li>Notification delivery records: 30 days. Devices whose notifications stopped working: removed 30 days later.</li>
      <li>When you delete your account, your account and content are deleted right away. Copies in our providers’ backups are removed as those backups expire.</li>
    </ul>

    <h2>How we protect it</h2>
    <p>Connections are encrypted (HTTPS). Every account can only read and change its own data — this is enforced by the database itself (row-level security), not just by the app.
      Secret keys are kept on the server only. Administrators can see account facts (such as email address, sign-up date and how many tasks you have) to run the service,
      but the admin tools don’t show the contents of your tasks, lists or reminders, and admin actions are logged.
      An account that breaks the Terms can be blocked (sign-in and data access stop; the data is kept) or deleted.</p>

    <h2>Your choices and rights</h2>
    <ul>
      <li><strong>Access and portability:</strong> download all your data any time from <a href="#/profile">Profile</a> (“Download a backup”).</li>
      <li><strong>Correction:</strong> edit anything in the app.</li>
      <li><strong>Deletion:</strong> delete individual items, or your whole account — see <a href="#/delete-account">Delete your account</a>.</li>
      <li><strong>Notifications:</strong> turn them off any time on the <a href="#/notifications">Notifications</a> page or in your browser settings.</li>
      <li><strong>Questions or complaints:</strong> contact us at ${contact()}. Our privacy contact is ${slot(LEGAL.privacyOfficer, 'name of the person responsible for privacy')}.
        If you’re not satisfied, you can contact the Office of the Privacy Commissioner of Canada or, in Québec, the Commission d’accès à l’information.</li>
    </ul>

    <h2>Children</h2>
    <p>DailyMate is not meant for children under 13, and we don’t knowingly collect their information.</p>

    <h2>Changes</h2>
    <p>If we change this policy in a way that matters, we’ll show a notice in the app before the change applies.</p>

    <h2>Contact</h2>
    <p>${operator()}<br>${slot(LEGAL.address, 'mailing address')}<br>${contact()}</p>`);
}

// ---- Terms of Service --------------------------------------------------------------------

function terms() {
  return page('Terms of Service', `Last updated ${updated()}`, `
    ${draftNote()}
    <p>These terms apply when you use DailyMate, provided by ${operator()}. By using DailyMate you agree to them.</p>
    <h2>The service</h2>
    <p>DailyMate helps you plan tasks, keep lists and set reminders. The free plan is offered as is, and features may change.
      Paid plans (DailyMate Plus) are not on sale yet; their terms will be added before they are.</p>
    <h2>Your account</h2>
    <p>Keep your password private and use a real email address you can access. You’re responsible for what happens in your account.
      You can delete your account at any time.</p>
    <h2>Your content</h2>
    <p>What you write in DailyMate stays yours. You allow us to store and process it only to provide the service to you.</p>
    <h2>Acceptable use</h2>
    <p>Don’t misuse DailyMate: no attempts to access other people’s data, disrupt the service, or use it for anything illegal.
      We may suspend accounts that do.</p>
    <h2>Reminders and notifications</h2>
    <p>We work to deliver reminders on time, but delivery depends on your device, browser, network and settings, and can be late or fail.
      <strong>Don’t rely on DailyMate as your only reminder for anything critical</strong>, such as medication or legal deadlines.</p>
    <h2>Liability</h2>
    <p>To the extent the law allows, we aren’t liable for indirect losses or for missed reminders. Nothing in these terms limits rights you have under consumer protection law
      in your province.</p>
    <h2>Changes and contact</h2>
    <p>We’ll give notice in the app before important changes. Questions: ${contact()}.
      These terms are governed by the laws of ${slot('', 'province')} and the federal laws of Canada that apply there.</p>`);
}

// ---- Storage & cookies -------------------------------------------------------------------

const STORAGE_ROWS = [
  ['dailymate.v1', 'Local storage', 'Your tasks, lists, reminders and name on this device.', 'Until you clear it or sign out'],
  ['dailymate.auth', 'Local storage', 'Keeps you signed in (only if you sign in).', 'Until you sign out'],
  ['dailymate.auth-code-verifier', 'Local storage', 'Briefly used to finish signing in from an email link.', 'Minutes'],
  ['dailymate.outbox, dailymate.sync', 'Local storage', 'Changes waiting to be uploaded, and when this device last synced (only if you sign in).', 'Until you sign out'],
  ['dailymate.push', 'Local storage', 'Remembers that this browser has notifications on (only if you turn them on).', 'Until you turn them off'],
  ['dailymate.ai.chat', 'Session storage', 'The AI Assistant conversation on this tab.', 'Until you close the tab'],
  ['dailymate-app-v1', 'Cache storage', 'A copy of the app’s own files so DailyMate opens without a connection.', 'Replaced on updates'],
];

function cookies() {
  return page('Storage & cookies', 'What DailyMate keeps in your browser, and why', `
    <p><strong>DailyMate doesn’t use cookies</strong>, and it has no advertising, analytics or tracking tools. That’s why you don’t see a cookie banner.</p>
    <p>To work, DailyMate saves a few things in your browser’s own storage (local storage, session storage and a file cache). They stay on your device,
      aren’t shared with other websites, and are all needed for features you use:</p>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Purpose</th><th scope="col">Kept</th></tr></thead>
        <tbody>${STORAGE_ROWS.map((r) => `<tr><td><code>${esc(r[0])}</code></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <p>Because all of these are strictly necessary for the service you ask for, there is nothing optional to switch off.
      If we ever add something optional (for example, usage statistics), we will ask you first and add a setting here to change your choice later.</p>
    <p>You can remove everything at any time by clearing this site’s data in your browser settings. If you aren’t signed in, that also deletes your tasks —
      download a backup first from <a href="#/profile">Profile</a>.</p>`);
}

// ---- Account deletion ------------------------------------------------------------------------

let deleting = false;

function deleteAccount() {
  const auth = cloud.getAuth();
  const action = auth.status === 'signed-in' ? `
    <form class="danger-zone" data-form="delete-account" novalidate>
      <h2>Delete my account now</h2>
      <p>This permanently deletes <strong>${esc(auth.user.email)}</strong> and everything saved in it: tasks, lists, reminders, notification settings and plan details.
        It can’t be undone. You may want to <a href="#/profile">download a backup</a> first.</p>
      <div class="field">
        <label class="field__label" for="delete-confirm">Type DELETE to confirm</label>
        <input class="input" id="delete-confirm" name="confirm" type="text" autocomplete="off" autocapitalize="characters" data-focus-key="delete-confirm">
      </div>
      <button class="btn btn--danger" type="submit" ${deleting ? 'disabled' : ''}>${deleting ? 'Deleting…' : 'Delete my account'}</button>
    </form>` : `
    <p>To delete your account, <a href="#/account">sign in</a> and come back to this page. If you can’t sign in, email ${contact()} from the address you signed up with
      and we’ll delete it for you within 30 days.</p>`;
  return page('Delete your account', 'How to remove your account and data', `
    <h2>What gets deleted</h2>
    <ul>
      <li>Your account (email address and password).</li>
      <li>All your tasks, lists, reminders and your display name stored in the cloud.</li>
      <li>Your notification settings for all devices, and any plan details.</li>
    </ul>
    <p>Deletion happens immediately. Copies in our providers’ backups disappear as those backups expire.
      Data saved only in a browser without an account isn’t on our servers — clear it in your browser’s settings.</p>
    ${action}`);
}

// ---- View ----------------------------------------------------------------------------------

const PAGES = { privacy, terms, cookies, 'delete-account': deleteAccount };
const TITLES = { privacy: 'Privacy Policy', terms: 'Terms of Service', cookies: 'Storage & cookies', 'delete-account': 'Delete your account' };

/** One view object per legal route. */
export function view(id) {
  return {
    pageTitle: () => TITLES[id],
    render: () => PAGES[id](),
    onSubmit: id === 'delete-account' ? onDeleteSubmit : undefined,
  };
}

async function onDeleteSubmit(e, ctx) {
  if (e.target.dataset.form !== 'delete-account') return;
  e.preventDefault();
  if (deleting) return;
  if (e.target.elements.confirm.value.trim().toUpperCase() !== 'DELETE') {
    toast('Please type DELETE to confirm.', { tone: 'error' });
    return;
  }
  deleting = true;
  ctx.rerender();
  try {
    await cloud.rpc('delete_my_account');
    await push.disable().catch(() => {});
    await cloud.signOut().catch(() => {});
    sync.detach();
    location.hash = '#/my-day';
    toast('Your account and its data were deleted');
  } catch (err) {
    toast(cloud.explain(err), { tone: 'error' });
  } finally {
    deleting = false;
    ctx.rerender();
  }
}
