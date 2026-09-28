package vn.lotusai.pos.counter;

// One paid action sends labels to the label printer, then cuts the kitchen
// ticket on the receipt printer, then cuts the customer's receipt there.
final class PrintFlow {
    interface Action { void run() throws Exception; }
    interface Kitchen { boolean run() throws Exception; }

    static boolean afterPayment(Action labels,Kitchen kitchen,Action receipts)throws Exception {
        labels.run();
        if(!kitchen.run())return false;
        receipts.run();
        return true;
    }

    static byte[] cut(){return new byte[]{29,86,65,0};} // ESC/POS GS V A 0: full cut
    static boolean endsWithCut(byte[] data){byte[] end=cut();if(data.length<end.length)return false;for(int i=0;i<end.length;i++)if(data[data.length-end.length+i]!=end[i])return false;return true;}
    private PrintFlow(){}
}
