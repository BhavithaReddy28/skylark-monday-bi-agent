// Monday.com GraphQL API Client
// Monday.com uses a GraphQL endpoint: https://api.monday.com/v2

class MondayClient {
  constructor(token) {
    this.token = token;
    this.apiUrl = 'https://api.monday.com/v2';
  }

  // Execute general GraphQL query
  async query(queryText, variables = {}) {
    if (!this.token) {
      throw new Error('Monday.com API Token is missing.');
    }
    
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.token,
        'API-Version': '2023-10' // Standard stable version
      },
      body: JSON.stringify({ query: queryText, variables })
    });

    const result = await response.json();
    if (result.errors) {
      console.error('Monday.com API errors:', result.errors);
      throw new Error(result.errors[0].message || 'Monday.com GraphQL Query error');
    }
    return result.data;
  }

  // Verify connection by fetching account details
  async verifyConnection() {
    try {
      const data = await this.query('query { account { name id } }');
      return { success: true, account: data.account };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Create a board
  async createBoard(name) {
    const queryStr = `
      mutation CreateBoard($name: String!) {
        create_board(board_name: $name, board_kind: public) {
          id
        }
      }
    `;
    const data = await this.query(queryStr, { name });
    return data.create_board.id;
  }

  // Create a column on a board
  async createColumn(boardId, title, type) {
    const queryStr = `
      mutation CreateColumn($boardId: ID!, $title: String!, $type: ColumnType!) {
        create_column(board_id: $boardId, title: $title, column_type: $type) {
          id
        }
      }
    `;
    const data = await this.query(queryStr, { boardId, title, type });
    return data.create_column.id;
  }

  // Fetch all columns of a board to map their IDs
  async getBoardColumns(boardId) {
    const queryStr = `
      query GetBoardColumns($boardId: [ID!]) {
        boards(ids: $boardId) {
          columns {
            id
            title
            type
          }
        }
      }
    `;
    const data = await this.query(queryStr, { boardId: [boardId] });
    if (!data.boards || data.boards.length === 0) {
      throw new Error(`Board not found: ${boardId}`);
    }
    return data.boards[0].columns;
  }

  // Read all items (rows) and column values from a board
  async getBoardItems(boardId) {
    const queryStr = `
      query GetBoardItems($boardId: [ID!]) {
        boards(ids: $boardId) {
          items_page(limit: 500) {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
      }
    `;
    const data = await this.query(queryStr, { boardId: [boardId] });
    if (!data.boards || data.boards.length === 0) {
      throw new Error(`Board not found: ${boardId}`);
    }
    
    const items = data.boards[0].items_page.items;
    
    // Convert column values into a flat object mapping column title or original key name
    const columns = await this.getBoardColumns(boardId);
    const colMap = {};
    columns.forEach(c => {
      colMap[c.id] = c.title;
    });

    return items.map(item => {
      const flatItem = {
        id: item.id,
        'Deal Name': item.name,
        'Deal name masked': item.name,
        'name': item.name
      };
      
      item.column_values.forEach(cv => {
        const title = colMap[cv.id];
        if (title) {
          // Parse JSON if possible (for numbers or complex types)
          flatItem[title] = cv.text || cv.value;
        }
      });
      
      return flatItem;
    });
  }

  // Create standard columns for Deals board
  async setupDealsBoard(boardId) {
    // Columns to create:
    const cols = [
      { title: 'Owner code', type: 'text' },
      { title: 'Client Code', type: 'text' },
      { title: 'Deal Status', type: 'text' },
      { title: 'Close Date (A)', type: 'date' },
      { title: 'Closure Probability', type: 'text' },
      { title: 'Masked Deal value', type: 'numbers' },
      { title: 'Tentative Close Date', type: 'date' },
      { title: 'Deal Stage', type: 'text' },
      { title: 'Product deal', type: 'text' },
      { title: 'Sector/service', type: 'text' },
      { title: 'Created Date', type: 'date' }
    ];

    for (const col of cols) {
      try {
        await this.createColumn(boardId, col.title, col.type);
      } catch (err) {
        console.warn(`Warning creating column ${col.title}:`, err.message);
      }
    }
  }

  // Create standard columns for Work Orders board
  async setupWorkOrdersBoard(boardId) {
    const cols = [
      { title: 'Customer Name Code', type: 'text' },
      { title: 'Serial #', type: 'text' },
      { title: 'Nature of Work', type: 'text' },
      { title: 'Last executed month of recurring project', type: 'text' },
      { title: 'Execution Status', type: 'text' },
      { title: 'Data Delivery Date', type: 'date' },
      { title: 'Date of PO/LOI', type: 'date' },
      { title: 'Document Type', type: 'text' },
      { title: 'Probable Start Date', type: 'date' },
      { title: 'Probable End Date', type: 'date' },
      { title: 'BD/KAM Personnel code', type: 'text' },
      { title: 'Sector', type: 'text' },
      { title: 'Type of Work', type: 'text' },
      { title: 'Is any Skylark software platform part of the client deliverables in this deal?', type: 'text' },
      { title: 'Last invoice date', type: 'date' },
      { title: 'latest invoice no.', type: 'text' },
      { title: 'Amount in Rupees (Excl of GST) (Masked)', type: 'numbers' },
      { title: 'Amount in Rupees (Incl of GST) (Masked)', type: 'numbers' },
      { title: 'Billed Value in Rupees (Excl of GST.) (Masked)', type: 'numbers' },
      { title: 'Billed Value in Rupees (Incl of GST.) (Masked)', type: 'numbers' },
      { title: 'Collected Amount in Rupees (Incl of GST.) (Masked)', type: 'numbers' },
      { title: 'Amount to be billed in Rs. (Exl. of GST) (Masked)', type: 'numbers' },
      { title: 'Amount to be billed in Rs. (Incl. of GST) (Masked)', type: 'numbers' },
      { title: 'Amount Receivable (Masked)', type: 'numbers' },
      { title: 'AR Priority account', type: 'text' },
      { title: 'Quantity by Ops', type: 'text' },
      { title: 'Quantities as per PO', type: 'text' },
      { title: 'Quantity billed (till date)', type: 'text' },
      { title: 'Balance in quantity', type: 'text' },
      { title: 'Invoice Status', type: 'text' },
      { title: 'Expected Billing Month', type: 'text' },
      { title: 'Actual Billing Month', type: 'text' },
      { title: 'Actual Collection Month', type: 'text' },
      { title: 'WO Status (billed)', type: 'text' },
      { title: 'Collection status', type: 'text' },
      { title: 'Collection Date', type: 'date' },
      { title: 'Billing Status', type: 'text' }
    ];

    for (const col of cols) {
      try {
        await this.createColumn(boardId, col.title, col.type);
      } catch (err) {
        console.warn(`Warning creating column ${col.title}:`, err.message);
      }
    }
  }

  // Push items to a board in batch
  async pushItems(boardId, items, isWorkOrder = false) {
    const columns = await this.getBoardColumns(boardId);
    
    // Map of title -> column ID
    const titleToId = {};
    columns.forEach(c => {
      titleToId[c.title] = c.id;
    });

    const mutationTemplate = `
      mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
          id
        }
      }
    `;

    console.log(`Pushing ${items.length} items to board ${boardId}...`);
    
    let successCount = 0;
    
    // Limit concurrency or process sequentially to stay within Monday API rate limits
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item['Deal Name'] || item['Deal name masked'] || `Item ${i+1}`;
      
      const columnValuesObj = {};
      
      Object.keys(item).forEach(key => {
        const colId = titleToId[key];
        if (colId) {
          let val = item[key];
          
          if (val === null || val === undefined || val === '') {
            return; // skip null values
          }
          
          const colType = columns.find(c => c.id === colId).type;
          
          if (colType === 'date') {
            // Monday.com date columns take a string in date format e.g. "YYYY-MM-DD"
            // Let's normalize it to YYYY-MM-DD
            if (typeof val === 'number') {
              const d = new Date((val - 25569) * 86400 * 1000);
              val = d.toISOString().split('T')[0];
            } else {
              const match = String(val).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
              if (match) {
                val = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
              } else {
                // Skip if date format is unrecognized
                return;
              }
            }
            columnValuesObj[colId] = { date: val };
          } else if (colType === 'numbers') {
            // Numbers can be integer or floats as a string/number
            let parsedNum = parseFloat(String(val).replace(/[\$,\s]/g, ''));
            if (!isNaN(parsedNum)) {
              columnValuesObj[colId] = String(parsedNum);
            }
          } else {
            // Text or other columns
            columnValuesObj[colId] = String(val);
          }
        }
      });

      try {
        await this.query(mutationTemplate, {
          boardId,
          itemName: String(name),
          columnValues: JSON.stringify(columnValuesObj)
        });
        successCount++;
        if (successCount % 20 === 0) {
          console.log(`Uploaded ${successCount}/${items.length} items...`);
        }
      } catch (err) {
        console.warn(`Failed to push item ${name} to Monday.com:`, err.message);
      }
    }
    
    return successCount;
  }
}

export default MondayClient;
