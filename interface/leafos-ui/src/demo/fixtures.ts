import type { PreviewData } from '../features/chat/model.js'

/** Sample data only. IDs have no routing semantics. */
const fixture: PreviewData = {
  installationId: 'preview-installation',
  currentHumanId: 'human-owner',
  actorsById: {
    'human-owner': {
      id: 'human-owner',
      kind: 'human',
      name: 'You',
    },
    admin: {
      id: 'admin',
      kind: 'agent',
      name: 'Admin',
      description: 'Your workspace guide',
      color: 'iris',
    },
    ari: {
      id: 'ari',
      kind: 'agent',
      name: 'Ari',
      description: 'Product partner',
      color: 'iris',
    },
    mira: {
      id: 'mira',
      kind: 'agent',
      name: 'Mira',
      description: 'Design partner',
      color: 'rose',
    },
    niko: {
      id: 'niko',
      kind: 'agent',
      name: 'Niko',
      description: 'Engineering partner',
      color: 'mint',
    },
  },
  agentRoles: [
    {
      agentId: 'admin',
      role: 'root-admin',
    },
  ],
  organizations: [
    {
      id: 'studio',
      name: 'Leaf Studio',
    },
    {
      id: 'field-notes',
      name: 'Field Notes',
    },
  ],
  memberships: [
    {
      id: 'membership-studio-human-owner',
      organizationId: 'studio',
      actorId: 'human-owner',
    },
    {
      id: 'membership-studio-ari',
      organizationId: 'studio',
      actorId: 'ari',
    },
    {
      id: 'membership-studio-mira',
      organizationId: 'studio',
      actorId: 'mira',
    },
    {
      id: 'membership-studio-niko',
      organizationId: 'studio',
      actorId: 'niko',
    },
    {
      id: 'membership-field-notes-human-owner',
      organizationId: 'field-notes',
      actorId: 'human-owner',
    },
    {
      id: 'membership-field-notes-ari',
      organizationId: 'field-notes',
      actorId: 'ari',
    },
    {
      id: 'membership-field-notes-mira',
      organizationId: 'field-notes',
      actorId: 'mira',
    },
  ],
  groups: [
    {
      id: 'product',
      organizationId: 'studio',
      name: 'Product',
    },
    {
      id: 'engineering',
      organizationId: 'studio',
      name: 'Engineering',
    },
    {
      id: 'research',
      organizationId: 'field-notes',
      name: 'Research',
    },
    {
      id: 'favorites',
      organizationId: 'field-notes',
      name: 'Favorites',
    },
  ],
  groupAssignments: [
    {
      groupId: 'product',
      membershipId: 'membership-studio-ari',
    },
    {
      groupId: 'product',
      membershipId: 'membership-studio-mira',
    },
    {
      groupId: 'engineering',
      membershipId: 'membership-studio-niko',
    },
    {
      groupId: 'research',
      membershipId: 'membership-field-notes-ari',
    },
    {
      groupId: 'research',
      membershipId: 'membership-field-notes-mira',
    },
    {
      groupId: 'favorites',
      membershipId: 'membership-field-notes-ari',
    },
  ],
  chatsById: {
    'chat-studio-ari': {
      id: 'chat-studio-ari',
      kind: 'direct',
      context: {
        kind: 'organization',
        organizationId: 'studio',
      },
      participantIds: ['human-owner', 'ari'],
    },
    'chat-studio-mira': {
      id: 'chat-studio-mira',
      kind: 'direct',
      context: {
        kind: 'organization',
        organizationId: 'studio',
      },
      participantIds: ['human-owner', 'mira'],
    },
    'chat-studio-niko': {
      id: 'chat-studio-niko',
      kind: 'direct',
      context: {
        kind: 'organization',
        organizationId: 'studio',
      },
      participantIds: ['human-owner', 'niko'],
    },
    'chat-field-notes-ari': {
      id: 'chat-field-notes-ari',
      kind: 'direct',
      context: {
        kind: 'organization',
        organizationId: 'field-notes',
      },
      participantIds: ['human-owner', 'ari'],
    },
    'chat-field-notes-mira': {
      id: 'chat-field-notes-mira',
      kind: 'direct',
      context: {
        kind: 'organization',
        organizationId: 'field-notes',
      },
      participantIds: ['human-owner', 'mira'],
    },
    'chat-admin': {
      id: 'chat-admin',
      kind: 'direct',
      context: {
        kind: 'installation',
        installationId: 'preview-installation',
      },
      participantIds: ['human-owner', 'admin'],
    },
  },
  threadsById: {
    'thread-morning': {
      id: 'thread-morning',
      chatId: 'chat-studio-ari',
      rootMessageId: 'message-morning',
      title: 'Your morning brief',
      messageIds: ['message-morning', 'message-m1', 'message-m2', 'message-m3'],
    },
    'thread-launch': {
      id: 'thread-launch',
      chatId: 'chat-studio-ari',
      rootMessageId: 'message-launch',
      title: 'Launch plan',
      messageIds: [
        'message-launch',
        'message-l1',
        'message-l2',
        'message-l3',
        'message-l4',
      ],
    },
    'thread-direction': {
      id: 'thread-direction',
      chatId: 'chat-studio-ari',
      rootMessageId: 'message-direction',
      title: 'A quieter visual direction',
      messageIds: ['message-direction', 'message-d1'],
    },
  },
  messagesById: {
    'message-morning': {
      id: 'message-morning',
      threadId: 'thread-morning',
      authorId: 'ari',
      createdAt: '2026-09-22T09:05:00Z',
      parts: [
        {
          type: 'text',
          text: 'Your morning brief is ready. Two updates are worth a look.',
        },
      ],
    },
    'message-m1': {
      id: 'message-m1',
      threadId: 'thread-morning',
      authorId: 'ari',
      createdAt: '2026-09-22T09:06:00Z',
      parts: [
        {
          type: 'text',
          text: 'The interface direction is ready to explore, and the desktop architecture has a clear starting point.',
        },
      ],
    },
    'message-m2': {
      id: 'message-m2',
      threadId: 'thread-morning',
      authorId: 'human-owner',
      createdAt: '2026-09-22T09:08:00Z',
      parts: [
        {
          type: 'text',
          text: 'Let\u2019s take a closer look at the interface first.',
        },
      ],
    },
    'message-m3': {
      id: 'message-m3',
      threadId: 'thread-morning',
      authorId: 'ari',
      createdAt: '2026-09-22T09:09:00Z',
      parts: [
        {
          type: 'text',
          text: 'Start with the launch plan below. We can keep the first version focused and build from there.',
        },
      ],
    },
    'message-launch': {
      id: 'message-launch',
      threadId: 'thread-launch',
      authorId: 'human-owner',
      createdAt: '2026-09-22T10:14:00Z',
      parts: [
        {
          type: 'text',
          text: 'Prepare a launch plan for the desktop app.\nAsk Niko to review the scope.',
        },
      ],
    },
    'message-l1': {
      id: 'message-l1',
      threadId: 'thread-launch',
      authorId: 'ari',
      createdAt: '2026-09-22T10:15:00Z',
      parts: [
        {
          type: 'text',
          text: 'I\u2019ll shape this into a focused desktop launch and ask Niko to review the scope.',
        },
      ],
    },
    'message-l2': {
      id: 'message-l2',
      threadId: 'thread-launch',
      authorId: 'human-owner',
      createdAt: '2026-09-22T10:16:00Z',
      parts: [
        {
          type: 'text',
          text: 'Keep the first release small. Desktop only.',
        },
      ],
    },
    'message-l3': {
      id: 'message-l3',
      threadId: 'thread-launch',
      authorId: 'ari',
      createdAt: '2026-09-22T10:18:00Z',
      parts: [
        {
          type: 'text',
          text: 'Three milestones: establish the interface, connect conversations to Core, then validate the desktop experience on each platform.',
        },
      ],
    },
    'message-l4': {
      id: 'message-l4',
      threadId: 'thread-launch',
      authorId: 'human-owner',
      createdAt: '2026-09-22T10:19:00Z',
      parts: [
        {
          type: 'text',
          text: 'Great. Let\u2019s start with an interface we can actually try.',
        },
      ],
    },
    'message-direction': {
      id: 'message-direction',
      threadId: 'thread-direction',
      authorId: 'human-owner',
      createdAt: '2026-09-22T10:28:00Z',
      parts: [
        {
          type: 'text',
          text: 'Explore a quieter visual direction.\nA little more space. A little less noise.',
        },
      ],
    },
    'message-d1': {
      id: 'message-d1',
      threadId: 'thread-direction',
      authorId: 'ari',
      createdAt: '2026-09-22T10:29:00Z',
      parts: [
        {
          type: 'text',
          text: 'Iris accents, calm neutral surfaces, and a clear reading area. Let the conversation take the lead.',
        },
      ],
    },
  },
  artifactsById: {},
}

export const initialOrganizationId = 'studio'
export const initialChatId = 'chat-studio-ari'
export const createPreviewData = (): PreviewData => structuredClone(fixture)
