import { showFailureToast } from '@raycast/utils';
import { keyRefusal } from './key-refusal';
import { REVIEW_WHAT_MARFA_SHARES, reviewWhatMarfaShares } from './components/ReauthorizeAction';

/**
 * Raise a key refusal as a toast that carries both halves of the answer.
 *
 * **A title alone is not an answer, and four surfaces were giving one.** They
 * passed `keyRefusal(...).title` and dropped the rest, so `showFailureToast`
 * filled the body with the server's raw message and offered Raycast's generic
 * report-a-bug button. Someone was told a permission had not been granted, on
 * a screen with nothing on it that could grant one — the dead end `keyRefusal`
 * exists to remove, reached from the three doors that are not the empty state.
 *
 * The way out rides on the toast only when it genuinely is one, so a role
 * refusal still offers nothing to press.
 *
 * **Its own module because `key-refusal.ts` has to stay pure.** Reaching the
 * consent flow means reaching `marfa-oauth`, which builds an `OAuth.PKCEClient`
 * at import time; under the test runner `@raycast/api` is a stub with no OAuth
 * on it, so a decision module importing this cannot be loaded by a test at all.
 * The rule this repository already states is to keep the answerable part in a
 * pure function a test can reach and leave the glue as glue, and the split is
 * that rule applied rather than a preference.
 */
export async function showRefusal(error: unknown): Promise<void> {
  const refusal = keyRefusal(error);
  await showFailureToast(error, {
    title: refusal.title,
    message: refusal.description,
    ...(refusal.reconsentHelps && {
      primaryAction: {
        title: REVIEW_WHAT_MARFA_SHARES,
        onAction: () => void reviewWhatMarfaShares(),
      },
    }),
  });
}
