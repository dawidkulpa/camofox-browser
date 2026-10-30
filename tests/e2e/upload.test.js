import fs from 'node:fs/promises';
import { createClient } from '../helpers/client.js';
import { getSharedEnv } from './sharedEnv.js';

describe('Upload', () => {
  let serverUrl;
  let testSiteUrl;
  let uploadFixture;
  let outsideUploadFixture;

  beforeAll(() => {
    const env = getSharedEnv();
    serverUrl = env.serverUrl;
    testSiteUrl = env.testSiteUrl;
    uploadFixture = env.uploadFixture;
    outsideUploadFixture = env.outsideUploadFixture;
  });

  test('POST /tabs/:tabId/upload attaches an in-root file to an existing input', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload`);
      const result = await client.upload(tabId, { path: uploadFixture });

      expect(result).toMatchObject({
        ok: true,
        via: 'direct_input',
        attached: [await fs.realpath(uploadFixture)],
      });

      const selected = await client.evaluate(tabId, "document.getElementById('selected').textContent");
      expect(selected).toMatchObject({ ok: true, result: 'upload.txt' });
    } finally {
      await client.cleanup();
    }
  });

  const fileNames = (client, tabId) => client.evaluate(tabId, `Object.fromEntries(
    [...document.querySelectorAll('input[type=file]')].map((input) => [input.id, [...input.files].map((file) => file.name)])
  )`);
  const onlyIn = (id) => expect.objectContaining({ [id]: ['upload.txt'] });

  async function expectOnlyFilled(client, tabId, id) {
    const { result } = await fileNames(client, tabId);
    expect(result).toEqual(onlyIn(id));
    expect(Object.entries(result).filter(([, files]) => files.length)).toHaveLength(1);
  }

  test('a selector puts the file in that input, not in the first one on the page', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);
      const result = await client.upload(tabId, { path: uploadFixture, selector: 'input[type="file"][data-ui="resume"]' });

      expect(result).toMatchObject({ ok: true, via: 'direct_input' });
      await expectOnlyFilled(client, tabId, 'resume');
    } finally {
      await client.cleanup();
    }
  });

  test('a snapshot ref puts the file in that input', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);
      const { snapshot } = await client.getSnapshot(tabId);
      const ref = snapshot.match(/"Resume"[^\n]*\[(e\d+)\]/)?.[1];
      expect(ref).toBeTruthy();

      await client.upload(tabId, { path: uploadFixture, ref });
      await expectOnlyFilled(client, tabId, 'resume');
    } finally {
      await client.cleanup();
    }
  });

  test('a selector for a label or a wrapper reaches the input it stands for', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);
      await client.upload(tabId, { path: uploadFixture, selector: '#cover-label' });
      await expectOnlyFilled(client, tabId, 'cover');

      const second = await client.createTab(`${testSiteUrl}/upload-many`);
      await client.upload(second.tabId, { path: uploadFixture, selector: '#resume-field' });
      await expectOnlyFilled(client, second.tabId, 'resume');
    } finally {
      await client.cleanup();
    }
  });

  test('a trigger that opens the chooser fills its own input', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);
      const result = await client.upload(tabId, { path: uploadFixture, selector: '#open-chooser', timeout: 4000 });

      expect(result).toMatchObject({ ok: true, via: 'filechooser' });
      await expectOnlyFilled(client, tabId, 'hidden-doc');
    } finally {
      await client.cleanup();
    }
  });

  test('a trigger that mounts an input fills the new one, even when it comes first', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);
      const result = await client.upload(tabId, { path: uploadFixture, selector: '#mount-panel' });

      expect(result).toMatchObject({ ok: true, via: 'panel_input' });
      await expectOnlyFilled(client, tabId, 'panel');
    } finally {
      await client.cleanup();
    }
  });

  test('several inputs and no target is refused instead of guessing', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);

      await expect(client.upload(tabId, { path: uploadFixture })).rejects.toMatchObject({ status: 422 });
      const { result } = await fileNames(client, tabId);
      expect(Object.values(result).flat()).toEqual([]);
    } finally {
      await client.cleanup();
    }
  });

  test('a selector that matches nothing is refused', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload-many`);

      await expect(client.upload(tabId, { path: uploadFixture, selector: '#missing' })).rejects.toMatchObject({ status: 422 });
    } finally {
      await client.cleanup();
    }
  });

  test('POST /tabs/:tabId/upload rejects a path outside the upload root', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/upload`);

      await expect(client.upload(tabId, { path: outsideUploadFixture }))
        .rejects.toMatchObject({ status: 400, data: { code: 'upload_path_outside_root' } });
    } finally {
      await client.cleanup();
    }
  });
});
