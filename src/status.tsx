import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  Keyboard,
  openExtensionPreferences,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { CONTRACT_VERSION } from '@withmarfa/client';
import { describeFailure, type Failure } from './failure';
import { currentKey, getInstance, serverUrl, type ApiKey } from './marfa';

/**
 * Whether the extension can work, and against what: the server it points at,
 * the contract the server speaks beside the one this build reads, and the key
 * as the server holds it: its label and what it may read and write. The
 * server's description needs no key, so a refused key still shows which
 * server refused it.
 */
export default function Status() {
  const instance = usePromise(getInstance, [], { onError: () => undefined });
  const key = usePromise(currentKey, [], { onError: () => undefined });
  const isLoading = instance.isLoading || key.isLoading;

  const instanceFailure = instance.error ? describeFailure(instance.error) : undefined;
  const keyFailure = key.error ? describeFailure(key.error) : undefined;
  const problem = instanceFailure ?? keyFailure;

  const markdown = isLoading
    ? ''
    : problem
      ? `## ${problem.title}\n\n${problem.message}`
      : '## Connected\n\nThe server answers and accepts the key.';

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Server URL" text={serverUrl() || 'Not set'} />
          {instance.data && (
            <>
              <Detail.Metadata.Label title="Server Version" text={instance.data.version} />
              <Detail.Metadata.Label title="Instance" text={instance.data.instance_id} />
            </>
          )}
          <Detail.Metadata.TagList title="Contract">
            <Detail.Metadata.TagList.Item
              text={
                instance.data
                  ? `Server ${String(instance.data.contract)}, extension ${String(CONTRACT_VERSION)}`
                  : `Extension ${String(CONTRACT_VERSION)}`
              }
              color={instanceFailure?.kind === 'contract' ? Color.Red : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="API Key">
            <Detail.Metadata.TagList.Item {...keyTag(isLoading, keyFailure)} />
          </Detail.Metadata.TagList>
          {key.data && <KeyGrants apiKey={key.data} />}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title="Check Again"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={() => {
              instance.revalidate();
              key.revalidate();
            }}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
          {instance.data && (
            <Action.CopyToClipboard title="Copy Instance ID" content={instance.data.instance_id} />
          )}
        </ActionPanel>
      }
    />
  );
}

function keyTag(isLoading: boolean, failure: Failure | undefined): { text: string; color: Color } {
  if (isLoading) return { text: 'Checking', color: Color.SecondaryText };
  if (!failure) return { text: 'Accepted', color: Color.Green };
  if (failure.kind === 'unauthorized') return { text: 'Refused', color: Color.Red };
  return { text: 'Not checked', color: Color.SecondaryText };
}

/** What the key may do, as the server holds it: the maps it names and any permission beyond them. */
function KeyGrants({ apiKey }: { apiKey: ApiKey }) {
  const permissions = apiKey.permissions ?? [];
  const maps: Array<[string, Record<string, string> | undefined]> = [
    ['Types', apiKey.type_permissions],
    ['Tags and Metadata', apiKey.metadata_permissions],
    ['Edges', apiKey.edge_permissions],
    ['Extensions', apiKey.extension_permissions],
    ['Profile', apiKey.profile_permissions],
  ];
  // An operator key runs the instance and sits outside the permission model:
  // its maps are empty by design, and it is refused on every read of items.
  if (apiKey.is_operator) {
    return (
      <>
        <Detail.Metadata.Separator />
        <Detail.Metadata.Label title="Key" text={apiKey.label} />
        <Detail.Metadata.TagList title="Kind">
          <Detail.Metadata.TagList.Item text="Operator key" color={Color.Red} />
        </Detail.Metadata.TagList>
        <Detail.Metadata.Label title="Reads Items" text="No. Mint a key for Raycast." />
      </>
    );
  }
  return (
    <>
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Key" text={apiKey.label} />
      <Detail.Metadata.Label title="Writes As" text={apiKey.source} />
      {maps.map(([title, map]) =>
        map && Object.keys(map).length > 0 ? (
          <Detail.Metadata.TagList key={title} title={title}>
            {Object.entries(map).map(([pattern, level]) => (
              <Detail.Metadata.TagList.Item key={pattern} text={`${pattern} ${level}`} />
            ))}
          </Detail.Metadata.TagList>
        ) : null,
      )}
      <Detail.Metadata.TagList title="Permissions">
        {permissions.length > 0 ? (
          permissions.map((permission) => (
            <Detail.Metadata.TagList.Item key={permission} text={permission} color={Color.Orange} />
          ))
        ) : (
          <Detail.Metadata.TagList.Item text="None" color={Color.Green} />
        )}
      </Detail.Metadata.TagList>
    </>
  );
}
