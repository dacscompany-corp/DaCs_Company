/**
 * Standardize the read / isRead field on notification docs.
 *
 * Background: most notification producers write `isRead: false`, but two
 * SOWA flows historically wrote `read: false`. The admin renderer reads
 * `isRead`, so SOWA notifications stayed "unread forever". Producers are
 * now standardized on `isRead`; the in-listener lazy migration patches up
 * the latest 30 docs for each user automatically on login. This script
 * lets you migrate ALL of your own notification history (older than the
 * latest 30) in one batch.
 *
 * Security rules only allow a user to read/update their OWN notifications,
 * so this script can only migrate the currently logged-in user. Clients
 * self-migrate via the lazy migration when they next open their portal.
 *
 * Usage (paste in browser devtools console while logged in):
 *   migrateNotifications();         // dry run — prints what would change
 *   migrateNotifications(true);     // commit — writes the updates
 */
window.migrateNotifications = async function (commit = false) {
    const uid = (window.auth && window.auth.currentUser && window.auth.currentUser.uid)
              || (firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid);
    if (!uid) { console.error('Not logged in.'); return; }

    const snap = await db.collection('notifications').doc(uid).collection('items').get();
    console.log(`Found ${snap.size} notification(s) for user ${uid}.`);

    const fix = [];
    snap.forEach(d => {
        const data = d.data();
        if ('read' in data && !('isRead' in data)) {
            fix.push({ id: d.id, ref: d.ref, read: data.read === true });
        }
    });

    if (!fix.length) {
        console.log('All notifications already have isRead. Nothing to migrate.');
        return;
    }

    console.log(`${fix.length} doc(s) need migration (have legacy "read" but no "isRead"):`);
    fix.forEach(f => console.log('  ', f.id, '→ isRead:', f.read));

    if (!commit) {
        console.warn(`DRY RUN. Call migrateNotifications(true) to actually write the updates.`);
        return;
    }

    // Firestore batch limit is 500. Split if needed.
    const chunks = [];
    for (let i = 0; i < fix.length; i += 400) chunks.push(fix.slice(i, i + 400));
    let written = 0;
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(f => batch.update(f.ref, { isRead: f.read }));
        await batch.commit();
        written += chunk.length;
        console.log(`  committed ${written}/${fix.length}`);
    }
    console.log(`Done. Migrated ${written} doc(s).`);
};

console.log('migrateNotifications() loaded. Run migrateNotifications() for dry-run, migrateNotifications(true) to commit.');
