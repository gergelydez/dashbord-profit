export const metadata = { title: 'Politică de confidențialitate — GLAMX Dashboard' };

export default function PrivacyPage() {
  return (
    <div style={{minHeight:'100vh',background:'#060b10',color:'#e8edf2',padding:'32px 20px'}}>
      <div style={{maxWidth:720,margin:'0 auto'}}>
        <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:28}}>
          <div style={{background:'linear-gradient(135deg,#f97316,#ea580c)',color:'#fff',fontWeight:800,fontSize:15,padding:'7px 12px',borderRadius:10}}>GLAMX</div>
          <div style={{fontSize:20,fontWeight:800}}>Politică de confidențialitate</div>
        </div>

        <div style={{fontSize:13,lineHeight:1.7,color:'#cbd5e1'}}>
          <p>Ultima actualizare: 19 septembrie 2026</p>

          <p>Această aplicație ("GLAMX Dashboard") este un instrument intern folosit de GLAMX SRL pentru gestionarea operațiunilor proprii (comenzi, facturare, curierat, contabilitate). Nu e un produs public și nu colectează date de la terți.</p>

          <h3 style={{color:'#f97316',marginTop:24}}>Ce date accesăm și de ce</h3>
          <p>Aplicația se poate conecta, la cererea explicită a utilizatorului, la contul său Google (Gmail și Google Drive), pentru a:</p>
          <ul>
            <li>citi (doar citire, <code>gmail.readonly</code>) email-uri primite de la expeditori cunoscuți (curieri, platforme de plăți/publicitate, contabilitate) care conțin facturi/documente financiare cu atașament;</li>
            <li>încărca (<code>drive.file</code>, doar fișiere create de aplicație) aceste atașamente într-un folder structurat pe Google Drive-ul propriu al utilizatorului, organizat pe an/lună/categorie.</li>
          </ul>

          <h3 style={{color:'#f97316',marginTop:24}}>Ce NU facem</h3>
          <ul>
            <li>Nu trimitem, ștergem sau modificăm email-uri.</li>
            <li>Nu accesăm fișiere din Drive create de altă aplicație — doar fișierele pe care le încărcăm noi.</li>
            <li>Nu vindem, nu partajăm și nu folosim datele în scop de marketing sau publicitate.</li>
            <li>Nu partajăm datele cu terți, cu excepția furnizorilor de infrastructură necesari funcționării aplicației (hosting — Vercel; bază de date — Neon), care nu au acces la conținutul email-urilor sau fișierelor.</li>
          </ul>

          <h3 style={{color:'#f97316',marginTop:24}}>Stocare și securitate</h3>
          <p>Datele de autentificare (token-uri OAuth) sunt criptate în baza de date proprie a aplicației. Documentele extrase sunt stocate exclusiv în contul Google Drive al utilizatorului, nu pe servere terțe.</p>

          <h3 style={{color:'#f97316',marginTop:24}}>Revocarea accesului</h3>
          <p>Utilizatorul poate revoca accesul aplicației la contul Google în orice moment din <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{color:'#3b82f6'}}>setările contului Google</a>, sau din pagina Documente a aplicației ("Deconectează").</p>

          <h3 style={{color:'#f97316',marginTop:24}}>Contact</h3>
          <p>Pentru întrebări despre această politică: <a href="mailto:gergelydezso93@gmail.com" style={{color:'#3b82f6'}}>gergelydezso93@gmail.com</a></p>
        </div>
      </div>
    </div>
  );
}
