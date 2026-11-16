let container = document.querySelector('.container');
let button = document.getElementById('spin');
let number = Math.ceil(5000 + Math.random() * 1000); //add by 500 to ensure at least 1 full rotation

button.onclick = function(){
  container.style.transform = "rotate(" + number + "deg)";
  number += Math.ceil(5000 + Math.random() * 1000);
  
}
