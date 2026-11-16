let orders = []

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

//render all orders
function renderOrders(){
    let orderCount = 0
    orders.forEach((currentOrder) => {
        orderCount += 1;
                // Create overall ticket
        const orderTicket = document.createElement("div");
        orderTicket.classList.add("order-ticket");

        // Generate title row
        const title = document.createElement("div");
        title.classList.add("titlerow");
        title.textContent = `ID: ${currentOrder.order_id} | ${'Name: N/A'}`;

        // Generate time row
        const time = document.createElement("div");
        time.classList.add("order-time");
        time.textContent = `Time Placed: ${currentOrder.order_timestamp}`;

        orderTicket.appendChild(title);
        orderTicket.appendChild(time);

        // Reading from items array, add each to its own row one at a time
        /*
        items.forEach((item, index) => {

            const itemRow = document.createElement("div");

            //allows different css colors to be applied
            itemRow.classList.add(
                index % 2 === 0 ? "orderrowodd" : "orderroweven"
            );

            itemRow.textContent = item;

            orderTicket.appendChild(itemRow);
        });

        // generates the completion button
        const completeButton = document.createElement("button");

        completeButton.classList.add("complete-button");
        completeButton.textContent = "Complete";
        completeButton.type = "button";

        // Remove ticket when completed
        completeButton.addEventListener("click", function() {
            orderTicket.remove();
        });

        orderTicket.appendChild(completeButton);

        // Add ticket to display
        document.getElementById("orders-container").appendChild(orderTicket);
        */

    });

    if (orderCount == 0){
        document.getElementById("orders-container").innerHTML = '<p>"All orders have been completed"</p>';
    }
    




    
    

}

async function loadOrders() {
  try {
    orders = await api('/api/orders');
    /*orders = orders.rows();
    orders = orders.filter((row) => {
        return row.orderStatus != 'Complete';
    });
    */
  } catch (err) {
    document.getElementById('orders-container').innerHTML = `<p class="error">Error loading orders</p>`;
    return;
  }
  //renderOrders();
}

//order ticket DOMS manipulation
function createOrderTicket(orderID, orderName, orderTime, items) {

    // Create overall ticket
    const orderTicket = document.createElement("div");
    orderTicket.classList.add("order-ticket");

    // Generate title row
    const title = document.createElement("div");
    title.classList.add("titlerow");
    title.textContent = `ID: ${orderID} | ${orderName}`;

    // Generate time row
    const time = document.createElement("div");
    time.classList.add("order-time");
    time.textContent = `Time Placed: ${orderTime}`;

    orderTicket.appendChild(title);
    orderTicket.appendChild(time);

    // Reading from items array, add each to its own row one at a time
    items.forEach((item, index) => {

        const itemRow = document.createElement("div");

        //allows different css colors to be applied
        itemRow.classList.add(
            index % 2 === 0 ? "orderrowodd" : "orderroweven"
        );

        itemRow.textContent = item;

        orderTicket.appendChild(itemRow);
    });

    // generates the completion button
    const completeButton = document.createElement("button");

    completeButton.classList.add("complete-button");
    completeButton.textContent = "Complete";
    completeButton.type = "button";

    // Remove ticket when completed
    completeButton.addEventListener("click", function() {
        orderTicket.remove();
    });

    orderTicket.appendChild(completeButton);

    // Add ticket to display
    document.getElementById("orders-container").appendChild(orderTicket);
}



//test button for createOrderTicket function
const quickTestButton = document.querySelector('#quickTest');

quickTestButton.addEventListener('click', () => {
  createOrderTicket("13", "James", "12:20", ["Strawberry Milk Tea", "Water Cup", "Berry Fruit Blast"]) //test values, need to link to backend
});


//dialog
const manualAddDialog = document.getElementById("manualAddDialog");
const manualAddButton = document.getElementById("manualAdd");
const submitManualButton = document.querySelector("#submitManualOrder");
const manualID = document.getElementById("manualOrderID");
const manualName = document.getElementById("manualOrderName");
const manualTime = document.getElementById("manualOrderTime");
const addItemButton = document.getElementById("addItemButton");
const orderItemsContainer = document.getElementById("orderItemsContainer");

// Open dialog
manualAddButton.addEventListener("click", () => {
    manualAddDialog.showModal();
});


// Add another item field
addItemButton.addEventListener("click", () => {

    const newInput = document.createElement("input");

    newInput.type = "text";
    newInput.classList.add("order-item-input");
    newInput.placeholder = "Enter item";
    newInput.required = true;

    orderItemsContainer.appendChild(newInput);

    newInput.focus();
});


// Cancel dialog
document.getElementById("cancelOrderButton").addEventListener("click", () => {
    manualAddDialog.close();
});


// Submit manual order
submitManualButton.addEventListener("click", () => {

    const IDText = manualID.value.trim();
    const nameText = manualName.value.trim();
    const timeText = manualTime.value;

    // Collect all item fields
    const itemInputs = document.querySelectorAll(".order-item-input");

    const items = Array.from(itemInputs)
        .map(input => input.value.trim())
        .filter(item => item !== "");

    // Validate input
    if (!IDText || !nameText || !timeText || items.length === 0) {
        alert("Please fill in all order details and add at least one item.");
        return;
    }

    // Create order
    createOrderTicket(IDText, nameText, timeText, items);

    // Reset form
    document.getElementById("popupForm").reset();

    // Reset item fields back to one
    orderItemsContainer.innerHTML = `
        <input
            type="text"
            class="order-item-input"
            placeholder="Enter item"
            required
        >
    `;

    // Close dialog
    manualAddDialog.close();

});

loadOrders();
