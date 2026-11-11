"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const install = require("../ws3-profile-api");
const { Readable } = require("node:stream");

function fakeApi() {
  const calls = { posts: [], uploads: [] };
  const api = {
    ctx: { userID: "123456789", jar: { session: true } },
    defaultFuncs: {
      async post(url, jar, form) {
        calls.posts.push({ url, jar, form });
        return { body: 'for (;;);{"data":{"success":true}}' };
      }
    },
    async httpPostFormData(url, form) {
      calls.uploads.push({ url, form });
      return 'for (;;);{"payload":{"fbid":"photo-42"}}';
    }
  };
  return { api, calls };
}

test("طبقة ws3 تعيد دعم تغيير بايو حساب البوت فقط", async () => {
  const { api, calls } = fakeApi();
  install(api);
  const response = await api.changeBio("نبذة البوت", false);
  assert.equal(response.data.success, true);
  assert.equal(calls.posts.length, 1);
  const form = calls.posts[0].form;
  assert.equal(form.av, "123456789");
  assert.equal(form.fb_api_req_friendly_name, "ProfileCometSetBioMutation");
  const variables = JSON.parse(form.variables);
  assert.equal(variables.input.actor_id, "123456789");
  assert.equal(variables.input.bio, "نبذة البوت");
});

test("طبقة ws3 ترفض خطأ GraphQL بدلاً من تأكيد نجاح كاذب", async () => {
  const { api } = fakeApi();
  api.defaultFuncs.post = async () => ({ body: '{"errors":[{"message":"Mutation rejected"}]}' });
  install(api);
  await assert.rejects(() => api.changeBio("test"), /Mutation rejected/);
});
