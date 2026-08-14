const mongoose = require('mongoose');

async function fixCardRequestReferenceIndex() {
  const db = mongoose.connection.db;

  if (!db) {
    console.log('ℹ️ Card index repair skipped: database not ready');
    return;
  }

  const cards = db.collection('cards');

  try {
    const indexes = await cards.indexes();
    const oldIndex = indexes.find(
      (index) => index.name === 'requestReference_1'
    );

    if (oldIndex) {
      const isSafePartialIndex =
        oldIndex.unique === true &&
        oldIndex.partialFilterExpression &&
        oldIndex.partialFilterExpression.requestReference &&
        oldIndex.partialFilterExpression.requestReference.$type === 'string';

      if (!isSafePartialIndex) {
        await cards.dropIndex('requestReference_1');
        console.log('✅ Old requestReference_1 index removed');
      } else {
        console.log('✅ requestReference_1 already safe');
        return;
      }
    }

    await cards.createIndex(
      { requestReference: 1 },
      {
        name: 'requestReference_1',
        unique: true,
        partialFilterExpression: {
          requestReference: { $type: 'string' },
        },
      }
    );

    console.log('✅ Safe requestReference_1 index created');
  } catch (error) {
    console.error(
      '⚠️ Card requestReference index repair:',
      error.message
    );
  }
}

module.exports = fixCardRequestReferenceIndex;
