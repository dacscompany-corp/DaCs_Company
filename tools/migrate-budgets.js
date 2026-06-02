// ════════════════════════════════════════════════════════════════════════
// ONE-TIME MIGRATION — split confidential financials out of folders/projects
// ════════════════════════════════════════════════════════════════════════
//
// WHY: Staff can read the `folders` and `projects` collections (they share the
// owner's data). To keep contract value (folder.totalBudget) and fund allocated
// (project.monthlyBudget) confidential from staff, those fields are moved into
// owner-only collections `folderBudgets` / `projectBudgets`. The app code already
// reads/writes the new location; this script migrates EXISTING documents.
//
// HOW TO RUN (once):
//   1. Deploy the updated firestore.rules FIRST (so the new collections are writable).
//   2. Log into admin.html as the OWNER account (NOT staff — staff are denied).
//   3. Open the browser DevTools console on that page.
//   4. Paste the entire contents of this file, press Enter.
//   5. It runs a DRY RUN first and prints what it WOULD do. Review the output.
//   6. To apply for real, run:   migrateBudgets({ dryRun: false })
//
// Safe to re-run: it copies the value into the new collection and then deletes
// the field from the original doc. Already-migrated docs (field absent) are skipped.
// ════════════════════════════════════════════════════════════════════════

async function migrateBudgets({ dryRun = true } = {}) {
    const _db = (typeof db !== 'undefined') ? db : firebase.firestore();
    const _auth = (typeof auth !== 'undefined') ? auth : firebase.auth();
    const user = _auth.currentUser;
    if (!user) { console.error('❌ Not signed in.'); return; }

    // Confirm this account is the owner (matches the owner-only rules).
    const meDoc = await _db.collection('users').doc(user.uid).get();
    const role = meDoc.exists ? (meDoc.data().role || 'owner') : null;
    if (role !== 'owner') {
        console.error(`❌ Signed in as role "${role}". Run this as the OWNER account.`);
        return;
    }
    const uid = user.uid;
    const DEL = firebase.firestore.FieldValue.delete();
    console.log(`%c${dryRun ? 'DRY RUN' : 'LIVE RUN'} — owner ${user.email} (${uid})`,
                'font-weight:bold;color:' + (dryRun ? '#b45309' : '#15803d'));

    let movedF = 0, movedP = 0, skippedF = 0, skippedP = 0;

    // ── Folders → folderBudgets.totalBudget ──
    const folders = await _db.collection('folders').where('userId', '==', uid).get();
    for (const doc of folders.docs) {
        const tb = doc.data().totalBudget;
        if (tb === undefined) { skippedF++; continue; }
        console.log(`  folder ${doc.id} → folderBudgets.totalBudget = ${tb}`);
        if (!dryRun) {
            await _db.collection('folderBudgets').doc(doc.id).set({ userId: uid, totalBudget: tb || 0 });
            await doc.ref.update({ totalBudget: DEL });
        }
        movedF++;
    }

    // ── Projects → projectBudgets.monthlyBudget ──
    const projects = await _db.collection('projects').where('userId', '==', uid).get();
    for (const doc of projects.docs) {
        const mb = doc.data().monthlyBudget;
        if (mb === undefined) { skippedP++; continue; }
        console.log(`  project ${doc.id} → projectBudgets.monthlyBudget = ${mb}`);
        if (!dryRun) {
            await _db.collection('projectBudgets').doc(doc.id).set({ userId: uid, monthlyBudget: mb || 0 });
            await doc.ref.update({ monthlyBudget: DEL });
        }
        movedP++;
    }

    console.log(`%c${dryRun ? 'WOULD MIGRATE' : 'MIGRATED'}: ${movedF} folders, ${movedP} projects ` +
                `(skipped ${skippedF} folders, ${skippedP} projects already done)`,
                'font-weight:bold');
    if (dryRun) console.log('%cRe-run with  migrateBudgets({ dryRun: false })  to apply.', 'color:#2563eb');
}

// Auto-run a dry run when pasted into the console.
migrateBudgets();
